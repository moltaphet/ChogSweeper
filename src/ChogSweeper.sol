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
///  1. `createSwap`: the maker escrows up to 10 ERC-721 tokens and/or MON, pays the platform fee, and states what they
///     want (up to 10 ERC-721 tokens and/or MON, possibly nothing at all, which makes the trade a gift), who may take it
///     (a specific wallet = Direct Swap, or `address(0)` = Open Counter) and an expiry.
///  2. `acceptSwap`: the taker sends exactly `wantedMon` and settles both sides atomically. The maker's fee is kept.
///     `declineSwap`: a designated taker rejects the trade; the escrow AND the fee return to the maker.
///     `cancelSwap`: the maker reclaims the escrow and the fee at any time before fulfilment, even after expiry.
///
/// Verified collections:
///  - Only ERC-721 collections on the owner-managed verified list can appear in a trade, on either side. This rules out
///    look-alike or hostile token contracts, whose `transferFrom` could take a taker's payment and deliver nothing.
///
/// Fee model (same shape as FoxySwap):
///  - The initiator (maker) pays a flat MON fee on top of the MON they escrow. It is locked in when the trade is created,
///    refunded if the trade is cancelled or declined, and kept by the platform only when the trade is accepted.
///  - The fee is zero while a promotion window is active (`feeWaivedUntil`) or when the maker holds at least one token
///    of the Chog collection. Holders of the optional partner collection get 25% off per token held, up to 4 (100%).
///  - `createSwap` requires `msg.value` to equal `offeredMon + fee` exactly. If the owner changes the fee while a
///    transaction is pending, that transaction reverts instead of charging a different amount.
///  - The taker pays exactly `wantedMon`, never a fee.
///  - Fees accrue in the contract and are pushed to the treasury by `withdrawFees`, so a reverting treasury can never
///    block trades.
///
/// Security notes:
///  - Every state-changing external function is `nonReentrant` and follows Checks-Effects-Interactions.
///  - ERC-721 tokens move with `transferFrom`, so receiver hooks cannot revert or re-enter to grief settlement.
///  - Deposits are verified with `ownerOf`, which rejects tokens that skip the transfer.
///  - Terms and the fee are immutable after creation; the owner can change only future fee parameters and the verified
///    list, never an existing trade.
///  - Holder checks are gas-capped `staticcall`s whose failure means "not a holder", so a faulty or hostile collection
///    contract cannot block creation.
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
    ///  slot 1: taker (160) | fee (96)
    ///  slot 2: offeredMon (128) | wantedMon (128)
    struct Trade {
        address maker;
        uint64 expiry;
        Status status;
        address taker;
        uint96 fee;
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

    /// @notice Number of partner-collection tokens that waive the whole fee; each token waives 1/PARTNER_MAX_TIERS of it.
    uint256 public constant PARTNER_MAX_TIERS = 4;

    /// @dev Gas forwarded to each holder `balanceOf` probe.
    uint256 private constant CHOG_PROBE_GAS = 50_000;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Number of trades ever created. Trade ids start at 1.
    uint256 public tradeCount;

    /// @notice Flat fee in wei the maker pays, on top of the MON they escrow, when creating a trade.
    uint128 public platformFee;

    /// @notice Fees are waived for every taker while `block.timestamp <= feeWaivedUntil`.
    uint64 public feeWaivedUntil;

    /// @notice Recipient of `withdrawFees`.
    address public treasury;

    /// @notice Holders of this ERC-721 collection pay no fee. `address(0)` disables the exemption.
    address public chogCollection;

    /// @notice Partner collection: each token held takes 25% off the fee, up to 4 tokens. `address(0)` disables it.
    address public partnerCollection;

    /// @notice Fees collected and not yet withdrawn.
    uint256 public accruedFees;

    /// @notice Collections that may appear in a trade.
    mapping(address collection => bool) public isVerified;

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
        uint64 expiry,
        uint256 fee
    );
    event TradeAccepted(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 fee);
    event TradeCancelled(uint256 indexed tradeId, address indexed maker);
    event TradeDeclined(uint256 indexed tradeId, address indexed maker, address indexed taker);

    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeWaivedUntilUpdated(uint64 until);
    event ChogCollectionUpdated(address indexed collection);
    event PartnerCollectionUpdated(address indexed collection);
    event CollectionVerified(address indexed collection, bool verified);
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
    error UnverifiedCollection(address collection);
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

    /// @notice Open a trade, escrowing the offered ERC-721 tokens and `offeredMon` MON, and paying the platform fee.
    /// @dev The caller must have approved this contract for every offered token and must send exactly
    ///      `offeredMon + feeFor(caller)` (see `quoteCreation`). Every collection on either side must be verified. The wanted
    ///      side may be empty and `wantedMon` may be zero: with both empty the trade is a pure gift.
    /// @param taker The only wallet allowed to accept (Direct Swap), or `address(0)` for anyone (Open Counter).
    /// @param offered ERC-721 tokens the maker deposits (may be empty if `offeredMon > 0`).
    /// @param wanted ERC-721 tokens the taker must deliver.
    /// @param offeredMon MON (wei) the maker escrows for the taker, excluding the fee.
    /// @param wantedMon MON (wei) the taker must pay the maker.
    /// @param expiry Unix timestamp; the trade can no longer be accepted after it.
    /// @return tradeId Identifier of the new trade.
    function createSwap(
        address taker,
        Asset[] calldata offered,
        Asset[] calldata wanted,
        uint128 offeredMon,
        uint128 wantedMon,
        uint64 expiry
    ) external payable nonReentrant returns (uint256 tradeId) {
        // ---- Checks ----
        if (offered.length > MAX_ASSETS_PER_SIDE || wanted.length > MAX_ASSETS_PER_SIDE) revert TooManyAssets();
        if (offered.length == 0 && offeredMon == 0) revert NothingOffered();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (taker == msg.sender) revert SelfTrade();

        // Only verified collections: a hostile token contract could keep a taker's payment and deliver nothing.
        for (uint256 i; i < offered.length; ++i) {
            if (!isVerified[offered[i].nft]) revert UnverifiedCollection(offered[i].nft);
        }
        for (uint256 i; i < wanted.length; ++i) {
            if (!isVerified[wanted[i].nft]) revert UnverifiedCollection(wanted[i].nft);
        }

        uint256 fee = _feeFor(msg.sender);
        if (msg.value != uint256(offeredMon) + fee) revert WrongValue();

        // ---- Effects ----
        unchecked {
            tradeId = ++tradeCount;
        }
        Trade storage t = _trades[tradeId];
        t.maker = msg.sender;
        t.expiry = expiry;
        t.status = Status.Active;
        t.taker = taker;
        t.fee = uint96(fee); // fee <= MAX_PLATFORM_FEE < 2**96
        t.offeredMon = offeredMon;
        t.wantedMon = wantedMon;
        for (uint256 i; i < offered.length; ++i) {
            t.offered.push(offered[i]);
        }
        for (uint256 i; i < wanted.length; ++i) {
            t.wanted.push(wanted[i]);
        }

        emit TradeCreated(tradeId, msg.sender, taker, offered, offeredMon, wanted, wantedMon, expiry, fee);

        // ---- Interactions ----
        for (uint256 i; i < offered.length; ++i) {
            IERC721 nft = IERC721(offered[i].nft);
            uint256 tokenId = offered[i].tokenId;
            nft.transferFrom(msg.sender, address(this), tokenId);
            if (nft.ownerOf(tokenId) != address(this)) revert EscrowDepositFailed();
        }
    }

    /// @notice Accept an active trade and settle both sides atomically.
    /// @dev `msg.value` must equal `wantedMon` exactly; the taker pays no fee (the maker paid it at creation and it is kept
    ///      now). The caller must have approved this contract for every wanted token. Acceptance is allowed up to and
    ///      including `expiry`.
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
        if (msg.value != wantedMon) revert WrongValue();

        // ---- Effects ----
        uint256 offeredMon = t.offeredMon;
        uint256 fee = t.fee;
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

    /// @notice Cancel an active trade and return the whole escrow, and the fee, to the maker.
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

    /// @notice Reject a Direct Swap addressed to you; the escrow and the maker's fee return to the maker.
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

    /// @notice Set the flat maker fee (wei). Applies to trades created from now on; existing trades keep the fee they paid.
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

    /// @notice Set the partner collection whose holders get 25% off per token (max 4). `address(0)` disables it.
    function setPartnerCollection(address collection) external onlyOwner {
        partnerCollection = collection;
        emit PartnerCollectionUpdated(collection);
    }

    /// @notice Add or remove collections from the verified list. Adding requires deployed code at the address.
    /// @dev Removing a collection does not touch trades that already hold its tokens; they can still settle or be cancelled.
    function setVerifiedCollections(address[] calldata collections, bool verified) external onlyOwner {
        for (uint256 i; i < collections.length; ++i) {
            address c = collections[i];
            if (verified && c.code.length == 0) revert InvalidAsset();
            isVerified[c] = verified;
            emit CollectionVerified(c, verified);
        }
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

    /// @notice The fee `maker` would pay if they created a trade now.
    function feeFor(address maker) external view returns (uint256) {
        return _feeFor(maker);
    }

    /// @notice The exact `msg.value` `maker` must send to create a trade that escrows `offeredMon` MON right now.
    function quoteCreation(address maker, uint256 offeredMon) external view returns (uint256) {
        return offeredMon + _feeFor(maker);
    }

    /// @notice The exact `msg.value` the taker must send to accept `tradeId`: the requested MON, no fee.
    function quoteAcceptance(uint256 tradeId, address) external view returns (uint256) {
        Trade storage t = _trades[tradeId];
        if (t.status == Status.None) revert TradeNotFound();
        return t.wantedMon;
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
            uint256 fee,
            Asset[] memory offered,
            Asset[] memory wanted
        )
    {
        Trade storage t = _trades[tradeId];
        return (t.maker, t.taker, t.status, t.expiry, t.offeredMon, t.wantedMon, t.fee, t.offered, t.wanted);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _requireActive(Trade storage t) private view {
        Status s = t.status;
        if (s == Status.None) revert TradeNotFound();
        if (s != Status.Active) revert TradeNotActive();
    }

    /// @dev Returns the escrowed assets and the fee to `to` and clears the stored bundles. Status must already be final.
    function _refundMaker(Trade storage t, address to) private {
        uint256 refundMon = uint256(t.offeredMon) + t.fee;
        Asset[] memory offered = t.offered;
        delete t.offered;
        delete t.wanted;

        for (uint256 i; i < offered.length; ++i) {
            IERC721(offered[i].nft).transferFrom(address(this), to, offered[i].tokenId);
        }
        if (refundMon != 0) _sendMon(to, refundMon);
    }

    function _feeFor(address maker) private view returns (uint256) {
        uint256 fee = platformFee;
        if (fee == 0 || block.timestamp <= feeWaivedUntil) return 0;
        if (_balanceOf(chogCollection, maker) != 0) return 0;
        uint256 tiers = _balanceOf(partnerCollection, maker);
        if (tiers == 0) return fee;
        if (tiers >= PARTNER_MAX_TIERS) return 0;
        return fee * (PARTNER_MAX_TIERS - tiers) / PARTNER_MAX_TIERS;
    }

    /// @dev Gas-capped, memory-safe `balanceOf` probe. Any failure (revert, out of gas, short or empty returndata, no
    ///      code, `collection == address(0)`) is treated as a balance of zero.
    function _balanceOf(address collection, address account) private view returns (uint256 held) {
        if (collection == address(0)) return 0;
        bytes memory callData = abi.encodeCall(IERC721.balanceOf, (account));
        bool ok;
        assembly ("memory-safe") {
            let out := mload(0x40)
            ok := staticcall(CHOG_PROBE_GAS, collection, add(callData, 0x20), mload(callData), out, 0x20)
            // Require a full 32-byte word (a call to an EOA succeeds with no returndata).
            if and(ok, iszero(lt(returndatasize(), 0x20))) { held := mload(out) }
        }
    }

    /// @dev Sends MON with a low-level call forwarding all gas; reverts on failure.
    function _sendMon(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
