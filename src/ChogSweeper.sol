// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ChogSweeper
/// @notice Peer-to-peer escrow for atomic swaps of ERC-721 bundles and native MON on Monad.
///
/// @dev Lifecycle of a trade:
///  1. `createSwap`: the maker escrows up to 10 ERC-721 tokens and/or MON and states what they want
///     (up to 10 ERC-721 tokens and/or MON, possibly nothing at all, which makes the trade a gift),
///     who may take it (a specific wallet = Direct Swap, or `address(0)` = Open Counter) and an expiry.
///  2. `acceptSwap`: the taker sends `wantedMon + fee` and settles both sides atomically.
///     `declineSwap`: a designated taker rejects the trade, returning the escrow to the maker.
///     `cancelSwap`: the maker reclaims the escrow at any time before fulfilment, even after expiry.
///
/// Fee model:
///  - A flat MON fee is added on top of the taker's payment, because pure NFT trades carry no MON
///    to deduct it from. The maker always receives exactly `wantedMon`.
///  - The fee is zero when a promotion window is active (`feeWaivedUntil`) or the taker holds at
///    least one token of the configured Chog collection.
///  - `acceptSwap` requires `msg.value` to match exactly. If the owner raises the fee while a
///    taker's transaction is pending, that transaction reverts instead of overcharging.
///  - Fees accrue in the contract and are pushed to the treasury by `withdrawFees`, so a reverting
///    treasury can never block trades.
///
/// Security notes:
///  - Every state-changing external function is `nonReentrant` and follows Checks-Effects-Interactions.
///  - ERC-721 tokens move with `transferFrom`, so receiver hooks cannot revert or re-enter to grief settlement.
///  - Deposits are verified with `ownerOf`, which rejects codeless addresses and tokens that skip the transfer.
///  - Terms are immutable after creation; the owner can change only fee parameters, never an existing trade.
///  - The Chog balance check is a gas-capped `staticcall` whose failure means "not a holder", so a faulty or
///    hostile collection contract cannot block acceptance.
///  - MON that is force-sent (selfdestruct/coinbase) is not tracked and stays in the contract.
contract ChogSweeper is ERC721Holder, ReentrancyGuard, Ownable2Step {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// @notice A single ERC-721 token reference.
    struct Asset {
        address nft;
        uint256 tokenId;
    }

    /// @notice Lifecycle of a trade. `None` means the id was never used.
    enum Status {
        None,
        Active,
        Accepted,
        Cancelled,
        Declined
    }

    /// @dev Packed storage layout:
    ///  slot 0: maker (160) | expiry (64) | status (8)
    ///  slot 1: taker (160)
    ///  slot 2: offeredMon (128) | wantedMon (128)
    struct Trade {
        address maker;
        uint64 expiry;
        Status status;
        address taker;
        uint128 offeredMon;
        uint128 wantedMon;
        Asset[] offered;
        Asset[] wanted;
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Maximum ERC-721 tokens per side; bounds the gas of every loop.
    uint256 public constant MAX_ASSETS_PER_SIDE = 10;

    /// @notice Hard ceiling for the platform fee, a guardrail against a compromised or mistaken owner.
    uint256 public constant MAX_PLATFORM_FEE = 10 ether;

    /// @dev Gas forwarded to the Chog `balanceOf` probe.
    uint256 private constant CHOG_PROBE_GAS = 50_000;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Number of trades ever created. Trade ids start at 1.
    uint256 public tradeCount;

    /// @notice Flat fee in wei charged to the taker on top of `wantedMon`.
    uint128 public platformFee;

    /// @notice Fees are waived for every taker while `block.timestamp <= feeWaivedUntil`.
    uint64 public feeWaivedUntil;

    /// @notice Recipient of `withdrawFees`.
    address public treasury;

    /// @notice Holders of this ERC-721 collection pay no fee. `address(0)` disables the exemption.
    address public chogCollection;

    /// @notice Fees collected and not yet withdrawn.
    uint256 public accruedFees;

    mapping(uint256 tradeId => Trade) private _trades;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event TradeCreated(
        uint256 indexed tradeId,
        address indexed maker,
        address indexed taker,
        Asset[] offered,
        uint256 offeredMon,
        Asset[] wanted,
        uint256 wantedMon,
        uint64 expiry
    );
    event TradeAccepted(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 fee);
    event TradeCancelled(uint256 indexed tradeId, address indexed maker);
    event TradeDeclined(uint256 indexed tradeId, address indexed maker, address indexed taker);

    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeWaivedUntilUpdated(uint64 until);
    event ChogCollectionUpdated(address indexed collection);
    event TreasuryUpdated(address indexed treasury);
    event FeesWithdrawn(address indexed treasury, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error TradeNotFound();
    error TradeNotActive();
    error Expired();
    error UnauthorizedTaker();
    error NotMaker();
    error TransferFailed();
    error WrongValue();
    error TooManyAssets();
    error NothingOffered();
    error InvalidExpiry();
    error SelfTrade();
    error AmountTooLarge();
    error InvalidAsset();
    error EscrowDepositFailed();
    error FeeTooHigh();
    error ZeroAddress();
    error NoFees();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param initialOwner Admin of the fee parameters (two-step ownership transfer).
    /// @param treasury_ Recipient of withdrawn fees.
    /// @param initialFee Flat taker fee in wei; must not exceed `MAX_PLATFORM_FEE`.
    constructor(address initialOwner, address treasury_, uint128 initialFee) Ownable(initialOwner) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (initialFee > MAX_PLATFORM_FEE) revert FeeTooHigh();
        treasury = treasury_;
        platformFee = initialFee;
        emit TreasuryUpdated(treasury_);
        emit PlatformFeeUpdated(0, initialFee);
    }

    /*//////////////////////////////////////////////////////////////
                              TRADE ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Open a trade, escrowing the offered ERC-721 tokens and `msg.value` MON.
    /// @dev The caller must have approved this contract for every offered token. The wanted side may be
    ///      empty and `wantedMon` may be zero: with both empty the trade is a pure gift.
    /// @param taker The only wallet allowed to accept (Direct Swap), or `address(0)` for anyone (Open Counter).
    /// @param offered ERC-721 tokens the maker deposits (may be empty if `msg.value > 0`).
    /// @param wanted ERC-721 tokens the taker must deliver.
    /// @param wantedMon MON (wei) the taker must pay the maker, excluding the platform fee.
    /// @param expiry Unix timestamp; the trade can no longer be accepted after it.
    /// @return tradeId Identifier of the new trade.
    function createSwap(
        address taker,
        Asset[] calldata offered,
        Asset[] calldata wanted,
        uint128 wantedMon,
        uint64 expiry
    ) external payable nonReentrant returns (uint256 tradeId) {
        // ---- Checks ----
        if (offered.length > MAX_ASSETS_PER_SIDE || wanted.length > MAX_ASSETS_PER_SIDE) revert TooManyAssets();
        if (offered.length == 0 && msg.value == 0) revert NothingOffered();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (taker == msg.sender) revert SelfTrade();
        if (msg.value > type(uint128).max) revert AmountTooLarge();

        // An address without code can never deliver a token, so reject it instead of creating a dead trade.
        for (uint256 i; i < wanted.length; ++i) {
            if (wanted[i].nft.code.length == 0) revert InvalidAsset();
        }

        // ---- Effects ----
        unchecked {
            tradeId = ++tradeCount;
        }
        Trade storage t = _trades[tradeId];
        t.maker = msg.sender;
        t.expiry = expiry;
        t.status = Status.Active;
        t.taker = taker;
        t.offeredMon = uint128(msg.value);
        t.wantedMon = wantedMon;
        for (uint256 i; i < offered.length; ++i) {
            t.offered.push(offered[i]);
        }
        for (uint256 i; i < wanted.length; ++i) {
            t.wanted.push(wanted[i]);
        }

        emit TradeCreated(tradeId, msg.sender, taker, offered, msg.value, wanted, wantedMon, expiry);

        // ---- Interactions ----
        for (uint256 i; i < offered.length; ++i) {
            IERC721 nft = IERC721(offered[i].nft);
            uint256 tokenId = offered[i].tokenId;
            nft.transferFrom(msg.sender, address(this), tokenId);
            if (nft.ownerOf(tokenId) != address(this)) revert EscrowDepositFailed();
        }
    }

    /// @notice Accept an active trade and settle both sides atomically.
    /// @dev `msg.value` must equal `wantedMon + fee` exactly (see `quoteAcceptance`). The caller must have
    ///      approved this contract for every wanted token. Acceptance is allowed up to and including `expiry`.
    /// @param tradeId Identifier returned by `createSwap`.
    function acceptSwap(uint256 tradeId) external payable nonReentrant {
        Trade storage t = _trades[tradeId];

        // ---- Checks ----
        _requireActive(t);
        if (block.timestamp > t.expiry) revert Expired();
        address maker = t.maker;
        address designated = t.taker;
        if (designated != address(0) && designated != msg.sender) revert UnauthorizedTaker();
        if (msg.sender == maker) revert SelfTrade();
        uint256 wantedMon = t.wantedMon;
        uint256 fee = _feeFor(msg.sender);
        if (msg.value != wantedMon + fee) revert WrongValue();

        // ---- Effects ----
        uint256 offeredMon = t.offeredMon;
        Asset[] memory offered = t.offered;
        Asset[] memory wanted = t.wanted;
        t.status = Status.Accepted;
        t.taker = msg.sender;
        delete t.offered;
        delete t.wanted;
        if (fee != 0) accruedFees += fee;

        emit TradeAccepted(tradeId, maker, msg.sender, fee);

        // ---- Interactions ----
        for (uint256 i; i < wanted.length; ++i) {
            IERC721(wanted[i].nft).transferFrom(msg.sender, maker, wanted[i].tokenId);
        }
        if (wantedMon != 0) _sendMon(maker, wantedMon);

        for (uint256 i; i < offered.length; ++i) {
            IERC721(offered[i].nft).transferFrom(address(this), msg.sender, offered[i].tokenId);
        }
        if (offeredMon != 0) _sendMon(msg.sender, offeredMon);
    }

    /// @notice Cancel an active trade and return the whole escrow to the maker.
    /// @dev Only the maker, at any time before fulfilment (expired trades included).
    /// @param tradeId Identifier returned by `createSwap`.
    function cancelSwap(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];

        // ---- Checks ----
        _requireActive(t);
        if (t.maker != msg.sender) revert NotMaker();

        // ---- Effects ----
        t.status = Status.Cancelled;
        emit TradeCancelled(tradeId, msg.sender);

        // ---- Interactions ----
        _refundMaker(t, msg.sender);
    }

    /// @notice Reject a Direct Swap addressed to you; the escrow returns to the maker.
    /// @dev Only the designated taker. Open Counter trades have no designated taker and cannot be declined.
    /// @param tradeId Identifier returned by `createSwap`.
    function declineSwap(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];

        // ---- Checks ----
        _requireActive(t);
        if (t.taker == address(0) || t.taker != msg.sender) revert UnauthorizedTaker();

        // ---- Effects ----
        address maker = t.maker;
        t.status = Status.Declined;
        emit TradeDeclined(tradeId, maker, msg.sender);

        // ---- Interactions ----
        _refundMaker(t, maker);
    }

    /*//////////////////////////////////////////////////////////////
                              FEE MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /// @notice Send all accrued fees to the treasury. Callable by anyone; funds can only go to `treasury`.
    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        if (amount == 0) revert NoFees();
        address to = treasury;
        accruedFees = 0;
        emit FeesWithdrawn(to, amount);
        _sendMon(to, amount);
    }

    /// @notice Set the flat taker fee (wei). Applies to trades accepted from now on, including existing ones.
    function setPlatformFee(uint128 newFee) external onlyOwner {
        if (newFee > MAX_PLATFORM_FEE) revert FeeTooHigh();
        emit PlatformFeeUpdated(platformFee, newFee);
        platformFee = newFee;
    }

    /// @notice Waive the fee for everyone until `until` (inclusive). Pass 0 to end a promotion.
    function setFeeWaivedUntil(uint64 until) external onlyOwner {
        feeWaivedUntil = until;
        emit FeeWaivedUntilUpdated(until);
    }

    /// @notice Set the collection whose holders trade fee-free. `address(0)` disables the exemption.
    function setChogCollection(address collection) external onlyOwner {
        chogCollection = collection;
        emit ChogCollectionUpdated(collection);
    }

    /// @notice Change the fee recipient.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The fee `taker` would pay if they accepted now.
    function feeFor(address taker) external view returns (uint256) {
        return _feeFor(taker);
    }

    /// @notice The exact `msg.value` `taker` must send to accept `tradeId` right now.
    function quoteAcceptance(uint256 tradeId, address taker) external view returns (uint256) {
        Trade storage t = _trades[tradeId];
        if (t.status == Status.None) revert TradeNotFound();
        return t.wantedMon + _feeFor(taker);
    }

    /// @notice Full details of a trade. Asset arrays are empty once the trade is settled.
    function getTrade(uint256 tradeId)
        external
        view
        returns (
            address maker,
            address taker,
            Status status,
            uint64 expiry,
            uint256 offeredMon,
            uint256 wantedMon,
            Asset[] memory offered,
            Asset[] memory wanted
        )
    {
        Trade storage t = _trades[tradeId];
        return (t.maker, t.taker, t.status, t.expiry, t.offeredMon, t.wantedMon, t.offered, t.wanted);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _requireActive(Trade storage t) private view {
        Status s = t.status;
        if (s == Status.None) revert TradeNotFound();
        if (s != Status.Active) revert TradeNotActive();
    }

    /// @dev Returns the escrowed assets to `to` and clears the stored bundles. Status must already be final.
    function _refundMaker(Trade storage t, address to) private {
        uint256 offeredMon = t.offeredMon;
        Asset[] memory offered = t.offered;
        delete t.offered;
        delete t.wanted;

        for (uint256 i; i < offered.length; ++i) {
            IERC721(offered[i].nft).transferFrom(address(this), to, offered[i].tokenId);
        }
        if (offeredMon != 0) _sendMon(to, offeredMon);
    }

    function _feeFor(address taker) private view returns (uint256) {
        uint256 fee = platformFee;
        if (fee == 0 || block.timestamp <= feeWaivedUntil) return 0;
        return _holdsChog(taker) ? 0 : fee;
    }

    /// @dev Gas-capped, memory-safe `balanceOf` probe. Any failure (revert, out of gas, short or empty
    ///      returndata, no code) is treated as "not a holder".
    function _holdsChog(address account) private view returns (bool holder) {
        address chog = chogCollection;
        if (chog == address(0)) return false;
        bytes memory callData = abi.encodeCall(IERC721.balanceOf, (account));
        uint256 held;
        bool ok;
        assembly ("memory-safe") {
            let out := mload(0x40)
            ok := staticcall(CHOG_PROBE_GAS, chog, add(callData, 0x20), mload(callData), out, 0x20)
            // Require a full 32-byte word, and code at the target (a call to an EOA succeeds with no returndata).
            if and(ok, iszero(lt(returndatasize(), 0x20))) { held := mload(out) }
        }
        return held != 0;
    }

    /// @dev Sends MON with a low-level call forwarding all gas; reverts on failure.
    function _sendMon(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
