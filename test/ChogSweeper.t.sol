// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ChogSweeper} from "../src/ChogSweeper.sol";

/*//////////////////////////////////////////////////////////////
                         TEST HELPERS
//////////////////////////////////////////////////////////////*/

contract MockNFT is ERC721 {
    constructor(string memory name_) ERC721(name_, "MOCK") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

/// @dev Token that pretends to transfer but does nothing, and lies about ownership.
contract FakeNFT {
    function transferFrom(address, address, uint256) external {}

    function ownerOf(uint256) external pure returns (address) {
        return address(0xdead);
    }
}

/// @dev Maker or taker contract whose `receive` tries to re-enter ChogSweeper.
contract ReentrantParty {
    enum Mode {
        Off,
        ReenterAccept,
        ReenterCancel,
        ReenterCreate,
        ReenterWithdraw,
        ReenterDecline
    }

    ChogSweeper public immutable sweeper;
    Mode public mode;
    uint256 public targetSwapId;
    bool public reentryAttempted;
    bool public reentryBlocked;
    bool public swallowFailure;

    constructor(ChogSweeper sweeper_) {
        sweeper = sweeper_;
    }

    function configure(Mode mode_, uint256 targetSwapId_, bool swallowFailure_) external {
        mode = mode_;
        targetSwapId = targetSwapId_;
        swallowFailure = swallowFailure_;
    }

    function create(
        address taker,
        ChogSweeper.Asset[] calldata offered,
        ChogSweeper.Asset[] calldata wanted,
        uint128 wantedMon,
        uint64 expiry
    ) external payable returns (uint256) {
        return sweeper.createSwap{value: msg.value}(taker, offered, wanted, wantedMon, expiry);
    }

    function accept(uint256 swapId) external payable {
        sweeper.acceptSwap{value: msg.value}(swapId);
    }

    function cancel(uint256 swapId) external {
        sweeper.cancelSwap(swapId);
    }

    function decline(uint256 swapId) external {
        sweeper.declineSwap(swapId);
    }

    function approveAll(address nft) external {
        MockNFT(nft).setApprovalForAll(address(sweeper), true);
    }

    receive() external payable {
        if (mode == Mode.Off) return;
        reentryAttempted = true;

        bytes memory data;
        if (mode == Mode.ReenterAccept) {
            data = abi.encodeCall(ChogSweeper.acceptSwap, (targetSwapId));
        } else if (mode == Mode.ReenterCancel) {
            data = abi.encodeCall(ChogSweeper.cancelSwap, (targetSwapId));
        } else if (mode == Mode.ReenterWithdraw) {
            data = abi.encodeCall(ChogSweeper.withdrawFees, ());
        } else if (mode == Mode.ReenterDecline) {
            data = abi.encodeCall(ChogSweeper.declineSwap, (targetSwapId));
        } else {
            ChogSweeper.Asset[] memory none = new ChogSweeper.Asset[](0);
            data = abi.encodeCall(ChogSweeper.createSwap, (address(0), none, none, 1, uint64(block.timestamp + 1)));
        }

        (bool ok, bytes memory ret) = address(sweeper).call(data);
        if (!ok && bytes4(ret) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector) {
            reentryBlocked = true;
        }
        // Either bubble the failure (settlement must revert) or swallow it (settlement completes).
        if (!ok && !swallowFailure) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// @dev ERC-721 that calls back into ChogSweeper from inside `transferFrom`.
contract ReentrantNFT is ERC721 {
    address public target;
    bytes public payload;
    bool public armed;
    bool public attempted;
    bool public blocked;

    constructor() ERC721("Evil", "EVIL") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        if (armed) {
            armed = false;
            attempted = true;
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok && bytes4(ret) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector) {
                blocked = true;
            }
            require(!ok, "reentry succeeded");  // nested call must be rejected by the guard
        }
        super.transferFrom(from, to, tokenId);
    }
}

/// @dev Contract that refuses native MON.
contract MonRejecter {
    function create(ChogSweeper sweeper, ChogSweeper.Asset[] calldata wanted, uint64 expiry) external payable {
        ChogSweeper.Asset[] memory none = new ChogSweeper.Asset[](0);
        sweeper.createSwap{value: msg.value}(address(0), none, wanted, 0, expiry);
    }
}

/*//////////////////////////////////////////////////////////////
                              TESTS
//////////////////////////////////////////////////////////////*/

contract ChogSweeperTest is Test {
    ChogSweeper internal sweeper;
    MockNFT internal nftA;
    MockNFT internal nftB;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal stranger = makeAddr("stranger");
    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");

    uint64 internal expiry;

    event TradeCreated(
        uint256 indexed tradeId,
        address indexed maker,
        address indexed taker,
        ChogSweeper.Asset[] offered,
        uint256 offeredMon,
        ChogSweeper.Asset[] wanted,
        uint256 wantedMon,
        uint64 expiry
    );
    event TradeAccepted(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 fee);
    event TradeDeclined(uint256 indexed tradeId, address indexed maker, address indexed taker);
    event TradeCancelled(uint256 indexed tradeId, address indexed maker);

    function setUp() public {
        sweeper = new ChogSweeper(owner, treasury, 0);
        nftA = new MockNFT("A");
        nftB = new MockNFT("B");
        expiry = uint64(block.timestamp + 1 days);

        vm.deal(maker, 1_000 ether);
        vm.deal(taker, 1_000 ether);
        vm.deal(stranger, 1_000 ether);

        vm.prank(maker);
        nftA.setApprovalForAll(address(sweeper), true);
        vm.prank(taker);
        nftB.setApprovalForAll(address(sweeper), true);
    }

    /*----------------------------- helpers -----------------------------*/

    function _assets(MockNFT nft, uint256 start, uint256 count) internal pure returns (ChogSweeper.Asset[] memory a) {
        a = new ChogSweeper.Asset[](count);
        for (uint256 i; i < count; ++i) {
            a[i] = ChogSweeper.Asset(address(nft), start + i);
        }
    }

    function _none() internal pure returns (ChogSweeper.Asset[] memory a) {
        a = new ChogSweeper.Asset[](0);
    }

    function _mintRange(MockNFT nft, address to, uint256 start, uint256 count) internal {
        for (uint256 i; i < count; ++i) {
            nft.mint(to, start + i);
        }
    }

    /// @dev Maker offers nftA #1 (+ `offeredMon`), wants nftB #1 (+ `wantedMon`).
    function _createStandardSwap(address designatedTaker, uint256 offeredMon, uint128 wantedMon)
        internal
        returns (uint256 id)
    {
        nftA.mint(maker, 1);
        nftB.mint(taker, 1);
        vm.prank(maker);
        id = sweeper.createSwap{value: offeredMon}(designatedTaker, _assets(nftA, 1, 1), _assets(nftB, 1, 1), wantedMon, expiry);
    }

    /*------------------------- happy paths -----------------------------*/

    function test_NftForNft_Swap() public {
        uint256 id = _createStandardSwap(taker, 0, 0);
        assertEq(id, 1);
        assertEq(nftA.ownerOf(1), address(sweeper));

        vm.expectEmit(true, true, true, true, address(sweeper));
        emit TradeAccepted(id, maker, taker, 0);
        vm.prank(taker);
        sweeper.acceptSwap(id);

        assertEq(nftA.ownerOf(1), taker);
        assertEq(nftB.ownerOf(1), maker);
        assertEq(address(sweeper).balance, 0);
        (,, ChogSweeper.Status status,,,, ChogSweeper.Asset[] memory off, ChogSweeper.Asset[] memory wan) =
            sweeper.getTrade(id);
        assertEq(uint8(status), uint8(ChogSweeper.Status.Accepted));
        assertEq(off.length, 0);
        assertEq(wan.length, 0);
    }

    function test_CreateEmitsEventWithFullTerms() public {
        nftA.mint(maker, 1);
        nftB.mint(taker, 1);
        ChogSweeper.Asset[] memory off = _assets(nftA, 1, 1);
        ChogSweeper.Asset[] memory wan = _assets(nftB, 1, 1);

        vm.expectEmit(true, true, true, true, address(sweeper));
        emit TradeCreated(1, maker, taker, off, 2 ether, wan, 3 ether, expiry);
        vm.prank(maker);
        sweeper.createSwap{value: 2 ether}(taker, off, wan, 3 ether, expiry);
    }

    function test_NftPlusMonForNftPlusMon() public {
        uint256 makerBefore = maker.balance;
        uint256 takerBefore = taker.balance;
        uint256 id = _createStandardSwap(address(0), 5 ether, 3 ether);
        assertEq(address(sweeper).balance, 5 ether);

        vm.prank(taker);
        sweeper.acceptSwap{value: 3 ether}(id);

        assertEq(maker.balance, makerBefore - 5 ether + 3 ether);
        assertEq(taker.balance, takerBefore - 3 ether + 5 ether);
        assertEq(nftA.ownerOf(1), taker);
        assertEq(nftB.ownerOf(1), maker);
        assertEq(address(sweeper).balance, 0);
    }

    function test_MonOnlyForNft() public {
        nftB.mint(taker, 7);
        vm.prank(maker);
        uint256 id = sweeper.createSwap{value: 10 ether}(address(0), _none(), _assets(nftB, 7, 1), 0, expiry);

        vm.prank(taker);
        sweeper.acceptSwap(id);

        assertEq(nftB.ownerOf(7), maker);
        assertEq(taker.balance, 1_010 ether);
        assertEq(address(sweeper).balance, 0);
    }

    function test_NftForMonOnly() public {
        nftA.mint(maker, 4);
        vm.prank(maker);
        uint256 id = sweeper.createSwap(address(0), _assets(nftA, 4, 1), _none(), 2 ether, expiry);

        vm.prank(stranger);
        sweeper.acceptSwap{value: 2 ether}(id);

        assertEq(nftA.ownerOf(4), stranger);
        assertEq(maker.balance, 1_002 ether);
        assertEq(address(sweeper).balance, 0);
    }

    function test_PublicSwapRecordsAcceptingTaker() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap(id);
        (, address recorded,,,,,,) = sweeper.getTrade(id);
        assertEq(recorded, taker);
    }

    function test_SwapIdsIncrement() public {
        nftA.mint(maker, 1);
        nftA.mint(maker, 2);
        vm.startPrank(maker);
        uint256 id1 = sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 1, expiry);
        uint256 id2 = sweeper.createSwap(address(0), _assets(nftA, 2, 1), _none(), 1, expiry);
        vm.stopPrank();
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(sweeper.tradeCount(), 2);
    }

    function test_BundleSwapAtMaxSize() public {
        uint256 max = sweeper.MAX_ASSETS_PER_SIDE();
        _mintRange(nftA, maker, 100, max);
        _mintRange(nftB, taker, 200, max);

        vm.prank(maker);
        uint256 id = sweeper.createSwap(address(0), _assets(nftA, 100, max), _assets(nftB, 200, max), 0, expiry);
        vm.prank(taker);
        sweeper.acceptSwap(id);

        for (uint256 i; i < max; ++i) {
            assertEq(nftA.ownerOf(100 + i), taker);
            assertEq(nftB.ownerOf(200 + i), maker);
        }
    }

    function test_MultiCollectionBundle() public {
        nftA.mint(maker, 1);
        nftB.mint(maker, 1);
        nftA.mint(taker, 2);
        vm.prank(maker);
        nftB.setApprovalForAll(address(sweeper), true);
        vm.prank(taker);
        nftA.setApprovalForAll(address(sweeper), true);

        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](2);
        off[0] = ChogSweeper.Asset(address(nftA), 1);
        off[1] = ChogSweeper.Asset(address(nftB), 1);

        vm.prank(maker);
        uint256 id = sweeper.createSwap(taker, off, _assets(nftA, 2, 1), 0, expiry);
        vm.prank(taker);
        sweeper.acceptSwap(id);

        assertEq(nftA.ownerOf(1), taker);
        assertEq(nftB.ownerOf(1), taker);
        assertEq(nftA.ownerOf(2), maker);
    }

    /*--------------------------- cancel --------------------------------*/

    function test_CancelReturnsEverything() public {
        uint256 makerBefore = maker.balance;
        uint256 id = _createStandardSwap(taker, 4 ether, 1 ether);

        vm.expectEmit(true, true, false, true, address(sweeper));
        emit TradeCancelled(id, maker);
        vm.prank(maker);
        sweeper.cancelSwap(id);

        assertEq(nftA.ownerOf(1), maker);
        assertEq(maker.balance, makerBefore);
        assertEq(address(sweeper).balance, 0);
        (,, ChogSweeper.Status status,,,,,) = sweeper.getTrade(id);
        assertEq(uint8(status), uint8(ChogSweeper.Status.Cancelled));
    }

    function test_CancelAfterExpiryStillWorks() public {
        uint256 id = _createStandardSwap(address(0), 1 ether, 0);
        vm.warp(expiry + 30 days);
        vm.prank(maker);
        sweeper.cancelSwap(id);
        assertEq(nftA.ownerOf(1), maker);
    }

    function test_OnlyMakerCanCancel() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.NotMaker.selector);
        sweeper.cancelSwap(id);
        vm.prank(stranger);
        vm.expectRevert(ChogSweeper.NotMaker.selector);
        sweeper.cancelSwap(id);
    }

    function test_CannotCancelTwice() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.startPrank(maker);
        sweeper.cancelSwap(id);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.cancelSwap(id);
        vm.stopPrank();
    }

    function test_CannotCancelAfterAccept() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap(id);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.cancelSwap(id);
    }

    function test_CannotAcceptAfterCancel() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(maker);
        sweeper.cancelSwap(id);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.acceptSwap(id);
    }

    function test_CannotCancelNonexistentSwap() public {
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.TradeNotFound.selector);
        sweeper.cancelSwap(999);
    }

    /*------------------------- accept failures -------------------------*/

    function test_CannotAcceptTwice() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap(id);
        vm.prank(stranger);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.acceptSwap(id);
    }

    function test_CannotAcceptNonexistentSwap() public {
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TradeNotFound.selector);
        sweeper.acceptSwap(42);
    }

    function test_UnauthorizedTakerReverts() public {
        uint256 id = _createStandardSwap(taker, 0, 0);
        vm.prank(stranger);
        vm.expectRevert(ChogSweeper.UnauthorizedTaker.selector);
        sweeper.acceptSwap(id);
    }

    function test_MakerCannotAcceptOwnSwap() public {
        uint256 id = _createStandardSwap(address(0), 1 ether, 0);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.SelfTrade.selector);
        sweeper.acceptSwap(id);
    }

    function test_CannotDesignateSelfAsTaker() public {
        nftA.mint(maker, 1);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.SelfTrade.selector);
        sweeper.createSwap(maker, _assets(nftA, 1, 1), _none(), 1, expiry);
    }

    function test_AcceptWithoutApprovalReverts() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        nftB.setApprovalForAll(address(sweeper), false);
        vm.prank(taker);
        vm.expectRevert();
        sweeper.acceptSwap(id);
        // Nothing moved and the swap is still open.
        assertEq(nftA.ownerOf(1), address(sweeper));
        (,, ChogSweeper.Status status,,,,,) = sweeper.getTrade(id);
        assertEq(uint8(status), uint8(ChogSweeper.Status.Active));
    }

    function test_AcceptWithoutOwningWantedTokenReverts() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(stranger);
        vm.expectRevert();
        sweeper.acceptSwap(id);
    }

    function test_AcceptWithWrongMonReverts() public {
        uint256 id = _createStandardSwap(address(0), 0, 3 ether);
        vm.startPrank(taker);
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap{value: 3 ether - 1}(id);
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap{value: 3 ether + 1}(id);
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap(id);
        vm.stopPrank();
    }

    function test_AcceptSendingMonWhenNoneWantedReverts() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap{value: 1}(id);
    }

    /*------------------------- expiry boundaries -----------------------*/

    function test_AcceptAtExactExpirySucceeds() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.warp(expiry);
        vm.prank(taker);
        sweeper.acceptSwap(id);
        assertEq(nftA.ownerOf(1), taker);
    }

    function test_AcceptOneSecondAfterExpiryReverts() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.warp(uint256(expiry) + 1);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.Expired.selector);
        sweeper.acceptSwap(id);
    }

    function test_CreateWithPastOrCurrentExpiryReverts() public {
        nftA.mint(maker, 1);
        vm.startPrank(maker);
        vm.expectRevert(ChogSweeper.InvalidExpiry.selector);
        sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 1, uint64(block.timestamp));
        vm.expectRevert(ChogSweeper.InvalidExpiry.selector);
        sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 1, 0);
        vm.stopPrank();
    }

    function test_CreateWithNextSecondExpirySucceeds() public {
        nftA.mint(maker, 1);
        vm.prank(maker);
        sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 1, uint64(block.timestamp + 1));
    }

    function testFuzz_ExpiryBoundary(uint64 delta, uint64 warpBy) public {
        delta = uint64(bound(delta, 1, 365 days));
        warpBy = uint64(bound(warpBy, 0, 2 * 365 days));
        nftA.mint(maker, 1);
        uint64 exp = uint64(block.timestamp) + delta;
        vm.prank(maker);
        uint256 id = sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 1, exp);

        vm.warp(block.timestamp + warpBy);
        vm.prank(taker);
        if (block.timestamp > exp) {
            vm.expectRevert(ChogSweeper.Expired.selector);
        }
        sweeper.acceptSwap{value: 1}(id);
    }

    /*------------------------ create validations -----------------------*/

    function test_TooManyOfferedReverts() public {
        uint256 over = sweeper.MAX_ASSETS_PER_SIDE() + 1;
        _mintRange(nftA, maker, 100, over);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.TooManyAssets.selector);
        sweeper.createSwap(address(0), _assets(nftA, 100, over), _none(), 1, expiry);
    }

    function test_TooManyWantedReverts() public {
        uint256 over = sweeper.MAX_ASSETS_PER_SIDE() + 1;
        nftA.mint(maker, 1);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.TooManyAssets.selector);
        sweeper.createSwap(address(0), _assets(nftA, 1, 1), _assets(nftB, 200, over), 0, expiry);
    }

    function test_NothingOfferedReverts() public {
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.NothingOffered.selector);
        sweeper.createSwap(address(0), _none(), _assets(nftB, 1, 1), 0, expiry);
    }

    function test_PureGift_NoWantedAssetsAndNoMon() public {
        nftA.mint(maker, 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap(taker, _assets(nftA, 1, 1), _none(), 0, expiry);

        vm.prank(taker);
        sweeper.acceptSwap(id);

        assertEq(nftA.ownerOf(1), taker);
        assertEq(address(sweeper).balance, 0);
    }

    function test_CreateWithUnownedTokenReverts() public {
        nftA.mint(stranger, 1);
        vm.prank(maker);
        vm.expectRevert();
        sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 1, expiry);
    }

    function test_CreateWithoutApprovalReverts() public {
        nftA.mint(maker, 1);
        vm.prank(maker);
        nftA.setApprovalForAll(address(sweeper), false);
        vm.prank(maker);
        vm.expectRevert();
        sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 1, expiry);
    }

    function test_OfferedAddressWithoutCodeReverts() public {
        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](1);
        off[0] = ChogSweeper.Asset(makeAddr("eoa"), 1);
        vm.prank(maker);
        vm.expectRevert();
        sweeper.createSwap(address(0), off, _none(), 1, expiry);
    }

    function test_WantedAddressWithoutCodeReverts() public {
        ChogSweeper.Asset[] memory wan = new ChogSweeper.Asset[](1);
        wan[0] = ChogSweeper.Asset(makeAddr("eoa"), 1);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.InvalidAsset.selector);
        sweeper.createSwap{value: 1 ether}(address(0), _none(), wan, 0, expiry);
    }

    function test_FakeNftThatSkipsTransferIsRejected() public {
        FakeNFT fake = new FakeNFT();
        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](1);
        off[0] = ChogSweeper.Asset(address(fake), 1);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.EscrowDepositFailed.selector);
        sweeper.createSwap(address(0), off, _none(), 1, expiry);
    }

    function test_DuplicateOfferedTokenReverts() public {
        nftA.mint(maker, 1);
        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](2);
        off[0] = ChogSweeper.Asset(address(nftA), 1);
        off[1] = ChogSweeper.Asset(address(nftA), 1);
        vm.prank(maker);
        vm.expectRevert();
        sweeper.createSwap(address(0), off, _none(), 1, expiry);
    }

    function test_MonAboveUint128Reverts() public {
        uint256 huge = uint256(type(uint128).max) + 1;
        vm.deal(maker, huge);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.AmountTooLarge.selector);
        sweeper.createSwap{value: huge}(address(0), _none(), _assets(nftB, 1, 1), 0, expiry);
    }

    function test_RejectsStrayNativeTransfers() public {
        vm.prank(stranger);
        (bool ok,) = address(sweeper).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(sweeper).balance, 0);
    }

    function test_ContractHoldsNftsViaSafeTransfer() public {
        // ERC721Holder lets the escrow receive safe transfers.
        nftA.mint(maker, 55);
        vm.prank(maker);
        nftA.safeTransferFrom(maker, address(sweeper), 55);
        assertEq(nftA.ownerOf(55), address(sweeper));
    }

    /*------------------------------ fuzz -------------------------------*/

    function testFuzz_MonSwapSettlesExactly(uint128 offeredMon, uint128 wantedMon) public {
        offeredMon = uint128(bound(offeredMon, 0, 1e27));
        wantedMon = uint128(bound(wantedMon, 0, 1e27));
        vm.deal(maker, uint256(offeredMon) + 1 ether);
        vm.deal(taker, uint256(wantedMon) + 1 ether);

        nftA.mint(maker, 1);
        nftB.mint(taker, 1);

        uint256 makerBefore = maker.balance;
        uint256 takerBefore = taker.balance;

        vm.prank(maker);
        uint256 id = sweeper.createSwap{value: offeredMon}(
            taker, _assets(nftA, 1, 1), _assets(nftB, 1, 1), wantedMon, expiry
        );
        assertEq(address(sweeper).balance, offeredMon);

        vm.prank(taker);
        sweeper.acceptSwap{value: wantedMon}(id);

        assertEq(maker.balance, makerBefore - offeredMon + wantedMon);
        assertEq(taker.balance, takerBefore - wantedMon + offeredMon);
        assertEq(address(sweeper).balance, 0);
        assertEq(nftA.ownerOf(1), taker);
        assertEq(nftB.ownerOf(1), maker);
    }

    function testFuzz_WrongMonAlwaysReverts(uint128 wantedMon, uint128 sent) public {
        wantedMon = uint128(bound(wantedMon, 0, 1e27));
        sent = uint128(bound(sent, 0, 1e27));
        vm.assume(sent != wantedMon);
        vm.deal(taker, 2e27);

        nftA.mint(maker, 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), wantedMon == 0 ? 1 : wantedMon, expiry);
        (,,,,, uint256 required,,) = sweeper.getTrade(id);

        vm.prank(taker);
        if (sent != required) vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap{value: sent}(id);
    }

    function testFuzz_CancelRefundsExactMon(uint128 offeredMon) public {
        offeredMon = uint128(bound(offeredMon, 1, 1e27));
        vm.deal(maker, offeredMon);

        vm.startPrank(maker);
        uint256 id = sweeper.createSwap{value: offeredMon}(address(0), _none(), _assets(nftB, 1, 1), 0, expiry);
        assertEq(maker.balance, 0);
        sweeper.cancelSwap(id);
        vm.stopPrank();

        assertEq(maker.balance, offeredMon);
        assertEq(address(sweeper).balance, 0);
    }

    function testFuzz_BundleSizes(uint8 offeredCount, uint8 wantedCount) public {
        uint256 max = sweeper.MAX_ASSETS_PER_SIDE();
        uint256 o = bound(offeredCount, 0, max);
        uint256 w = bound(wantedCount, 0, max);
        vm.assume(o > 0 || w > 0);

        _mintRange(nftA, maker, 1000, o);
        _mintRange(nftB, taker, 2000, w);

        uint128 wantedMon = w == 0 ? 1 ether : 0;
        uint256 offeredMon = o == 0 ? 1 ether : 0;

        vm.prank(maker);
        uint256 id =
            sweeper.createSwap{value: offeredMon}(address(0), _assets(nftA, 1000, o), _assets(nftB, 2000, w), wantedMon, expiry);
        vm.prank(taker);
        sweeper.acceptSwap{value: wantedMon}(id);

        for (uint256 i; i < o; ++i) {
            assertEq(nftA.ownerOf(1000 + i), taker);
        }
        for (uint256 i; i < w; ++i) {
            assertEq(nftB.ownerOf(2000 + i), maker);
        }
        assertEq(address(sweeper).balance, 0);
    }

    function testFuzz_OnlyDesignatedTakerCanAccept(address caller) public {
        vm.assume(caller != taker && caller != maker && caller != address(0));
        uint256 id = _createStandardSwap(taker, 0, 0);
        vm.prank(caller);
        vm.expectRevert(ChogSweeper.UnauthorizedTaker.selector);
        sweeper.acceptSwap(id);
    }

    function testFuzz_OnlyMakerCanCancel(address caller) public {
        vm.assume(caller != maker);
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(caller);
        vm.expectRevert(ChogSweeper.NotMaker.selector);
        sweeper.cancelSwap(id);
    }

    /*------------------------ reentrancy attacks -----------------------*/

    /// A taker contract tries to re-enter `acceptSwap` while receiving the maker's MON.
    function test_Reentrancy_TakerReentersAcceptOnPayout_Reverts() public {
        ReentrantParty attacker = new ReentrantParty(sweeper);
        vm.deal(address(attacker), 10 ether);

        // Victim swap the attacker would like to drain on re-entry.
        nftA.mint(maker, 1);
        vm.prank(maker);
        uint256 victimId = sweeper.createSwap{value: 5 ether}(address(0), _assets(nftA, 1, 1), _none(), 1 ether, expiry);
        nftA.mint(maker, 2);
        vm.prank(maker);
        uint256 payoutId = sweeper.createSwap{value: 2 ether}(address(0), _assets(nftA, 2, 1), _none(), 1 ether, expiry);

        attacker.configure(ReentrantParty.Mode.ReenterAccept, victimId, false);
        vm.expectRevert(ChogSweeper.TransferFailed.selector);
        attacker.accept{value: 1 ether}(payoutId);

        assertEq(address(sweeper).balance, 7 ether);
        assertEq(nftA.ownerOf(1), address(sweeper));
        assertEq(nftA.ownerOf(2), address(sweeper));
    }

    /// Same attack, but the attacker swallows the failure so settlement completes: the guard
    /// must still have blocked the nested call and no extra funds can leave the escrow.
    function test_Reentrancy_TakerSwallowsBlockedReentry_NoExtraFunds() public {
        ReentrantParty attacker = new ReentrantParty(sweeper);
        vm.deal(address(attacker), 10 ether);

        nftA.mint(maker, 1);
        vm.prank(maker);
        uint256 victimId = sweeper.createSwap{value: 5 ether}(address(0), _assets(nftA, 1, 1), _none(), 1 ether, expiry);
        nftA.mint(maker, 2);
        vm.prank(maker);
        uint256 payoutId = sweeper.createSwap{value: 2 ether}(address(0), _assets(nftA, 2, 1), _none(), 1 ether, expiry);

        attacker.configure(ReentrantParty.Mode.ReenterAccept, victimId, true);
        attacker.accept{value: 1 ether}(payoutId);

        assertTrue(attacker.reentryAttempted());
        assertTrue(attacker.reentryBlocked());
        // Attacker got only its own swap (2 ETH) for 1 ETH; the victim swap is untouched.
        assertEq(address(attacker).balance, 10 ether + 2 ether);
        assertEq(address(sweeper).balance, 5 ether);
        assertEq(nftA.ownerOf(1), address(sweeper));
    }

    /// A taker contract tries to cancel the swap being settled while receiving MON.
    function test_Reentrancy_TakerReentersCancelOnPayout_Blocked() public {
        ReentrantParty attacker = new ReentrantParty(sweeper);
        vm.deal(address(attacker), 10 ether);

        nftA.mint(maker, 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap{value: 2 ether}(address(0), _assets(nftA, 1, 1), _none(), 1 ether, expiry);

        attacker.configure(ReentrantParty.Mode.ReenterCancel, id, true);
        attacker.accept{value: 1 ether}(id);

        assertTrue(attacker.reentryBlocked());
        assertEq(nftA.ownerOf(1), address(attacker));
        assertEq(address(sweeper).balance, 0);
    }

    /// A maker contract tries to re-enter while receiving the taker's MON during acceptance.
    function test_Reentrancy_MakerReentersOnPayment_Reverts() public {
        ReentrantParty evilMaker = new ReentrantParty(sweeper);
        vm.deal(address(evilMaker), 10 ether);

        nftA.mint(address(evilMaker), 1);
        evilMaker.approveAll(address(nftA));
        uint256 id = evilMaker.create(address(0), _assets(nftA, 1, 1), _none(), 1 ether, expiry);

        evilMaker.configure(ReentrantParty.Mode.ReenterCancel, id, false);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TransferFailed.selector);
        sweeper.acceptSwap{value: 1 ether}(id);

        // Swap remains open and intact, so the maker can still cancel normally.
        assertEq(nftA.ownerOf(1), address(sweeper));
        evilMaker.configure(ReentrantParty.Mode.Off, 0, false);
        evilMaker.cancel(id);
        assertEq(nftA.ownerOf(1), address(evilMaker));
    }

    function test_Reentrancy_MakerSwallowsBlockedReentryOnPayment() public {
        ReentrantParty evilMaker = new ReentrantParty(sweeper);
        nftA.mint(address(evilMaker), 1);
        evilMaker.approveAll(address(nftA));
        uint256 id = evilMaker.create(address(0), _assets(nftA, 1, 1), _none(), 1 ether, expiry);

        evilMaker.configure(ReentrantParty.Mode.ReenterCancel, id, true);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id);

        assertTrue(evilMaker.reentryBlocked());
        assertEq(nftA.ownerOf(1), taker);
        assertEq(address(evilMaker).balance, 1 ether);
        assertEq(address(sweeper).balance, 0);
    }

    /// A maker contract tries to open a new swap from inside the cancel refund.
    function test_Reentrancy_MakerReentersCreateOnCancelRefund_Blocked() public {
        ReentrantParty evilMaker = new ReentrantParty(sweeper);
        vm.deal(address(evilMaker), 5 ether);
        uint256 id = evilMaker.create{value: 5 ether}(address(0), _none(), _assets(nftB, 1, 1), 0, expiry);

        evilMaker.configure(ReentrantParty.Mode.ReenterCreate, 0, true);
        evilMaker.cancel(id);

        assertTrue(evilMaker.reentryBlocked());
        assertEq(address(evilMaker).balance, 10 ether);
        assertEq(address(sweeper).balance, 0);
        assertEq(sweeper.tradeCount(), 1);
    }

    /// A hostile ERC-721 re-enters `cancelSwap` from within its own `transferFrom`
    /// while the escrow is releasing it during acceptance. The nested call must be rejected
    /// by the guard, and the outer settlement must still complete exactly once.
    function test_Reentrancy_HostileNftOnAcceptRelease_Blocked() public {
        ReentrantNFT evil = new ReentrantNFT();
        evil.mint(maker, 1);
        vm.prank(maker);
        evil.setApprovalForAll(address(sweeper), true);

        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](1);
        off[0] = ChogSweeper.Asset(address(evil), 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap(address(0), off, _none(), 1 ether, expiry);

        evil.arm(address(sweeper), abi.encodeCall(ChogSweeper.cancelSwap, (id)));
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id);

        assertTrue(evil.attempted());
        assertTrue(evil.blocked());
        assertEq(evil.ownerOf(1), taker);
        assertEq(maker.balance, 1_001 ether);
        assertEq(address(sweeper).balance, 0);
    }

    /// A hostile wanted-side ERC-721 re-enters `acceptSwap` while the taker's token is pulled.
    function test_Reentrancy_HostileNftOnTakerPull_Blocked() public {
        ReentrantNFT evil = new ReentrantNFT();
        evil.mint(taker, 1);
        vm.prank(taker);
        evil.setApprovalForAll(address(sweeper), true);

        nftA.mint(maker, 1);
        ChogSweeper.Asset[] memory wan = new ChogSweeper.Asset[](1);
        wan[0] = ChogSweeper.Asset(address(evil), 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap(address(0), _assets(nftA, 1, 1), wan, 0, expiry);

        evil.arm(address(sweeper), abi.encodeCall(ChogSweeper.acceptSwap, (id)));
        vm.prank(taker);
        sweeper.acceptSwap(id);

        assertTrue(evil.blocked());
        assertEq(nftA.ownerOf(1), taker);
        assertEq(evil.ownerOf(1), maker);
    }

    /// A hostile NFT re-enters `createSwap` while being pulled into escrow.
    function test_Reentrancy_HostileNftDuringCreate_Blocked() public {
        ReentrantNFT evil = new ReentrantNFT();
        evil.mint(maker, 1);
        vm.prank(maker);
        evil.setApprovalForAll(address(sweeper), true);

        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](1);
        off[0] = ChogSweeper.Asset(address(evil), 1);
        evil.arm(
            address(sweeper), abi.encodeCall(ChogSweeper.createSwap, (address(0), _none(), _none(), 1, uint64(block.timestamp + 1)))
        );

        vm.prank(maker);
        sweeper.createSwap(address(0), off, _none(), 1, expiry);

        assertTrue(evil.blocked());
        assertEq(sweeper.tradeCount(), 1);
        assertEq(evil.ownerOf(1), address(sweeper));
    }

    /// A taker that cannot receive MON makes acceptance revert atomically, not partially settle.
    function test_MonRejectingMakerCausesFullRevert() public {
        MonRejecter rejecter = new MonRejecter();
        nftB.mint(taker, 9);
        vm.deal(address(rejecter), 1 ether);

        // The rejecter is the maker of a MON-for-NFT swap; its own receive-less code
        // makes the payout of the taker's MON fail (wantedMon > 0).
        ChogSweeper.Asset[] memory wan = _assets(nftB, 9, 1);
        // wantedMon > 0 cannot be set via MonRejecter.create (passes 0), so build directly.
        vm.prank(address(rejecter));
        uint256 id = sweeper.createSwap{value: 1 ether}(address(0), _none(), wan, 1 ether, expiry);

        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TransferFailed.selector);
        sweeper.acceptSwap{value: 1 ether}(id);

        assertEq(nftB.ownerOf(9), taker);
        assertEq(address(sweeper).balance, 1 ether);
    }

    /*=========================== fees ===========================*/

    function _setFee(uint128 fee) internal {
        vm.prank(owner);
        sweeper.setPlatformFee(fee);
    }

    function test_Constructor_SetsState() public view {
        assertEq(sweeper.owner(), owner);
        assertEq(sweeper.treasury(), treasury);
        assertEq(sweeper.platformFee(), 0);
    }

    function test_Constructor_RejectsBadArguments() public {
        vm.expectRevert(ChogSweeper.ZeroAddress.selector);
        new ChogSweeper(owner, address(0), 0);
        uint128 tooHigh = uint128(sweeper.MAX_PLATFORM_FEE()) + 1;
        vm.expectRevert(ChogSweeper.FeeTooHigh.selector);
        new ChogSweeper(owner, treasury, tooHigh);
    }

    function test_Fee_TakerPaysOnTop_MakerReceivesExactly() public {
        _setFee(0.5 ether);
        uint256 id = _createStandardSwap(address(0), 5 ether, 3 ether);
        uint256 makerBefore = maker.balance;
        uint256 takerBefore = taker.balance;

        assertEq(sweeper.quoteAcceptance(id, taker), 3.5 ether);

        vm.expectEmit(true, true, true, true, address(sweeper));
        emit TradeAccepted(id, maker, taker, 0.5 ether);
        vm.prank(taker);
        sweeper.acceptSwap{value: 3.5 ether}(id);

        assertEq(maker.balance, makerBefore + 3 ether);
        assertEq(taker.balance, takerBefore - 3.5 ether + 5 ether);
        assertEq(sweeper.accruedFees(), 0.5 ether);
        assertEq(address(sweeper).balance, 0.5 ether);
    }

    function test_Fee_PureNftTradeStillPaysFee() public {
        _setFee(1 ether);
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap(id);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id);
        assertEq(sweeper.accruedFees(), 1 ether);
    }

    function test_Fee_WrongValueAlwaysReverts() public {
        _setFee(1 ether);
        uint256 id = _createStandardSwap(address(0), 0, 2 ether);
        vm.startPrank(taker);
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap{value: 2 ether}(id); // forgot the fee
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap{value: 3 ether + 1}(id); // overpaying is refused, not kept
        vm.stopPrank();
    }

    function test_Fee_RaisedWhileTxPending_RevertsInsteadOfOvercharging() public {
        _setFee(1 ether);
        uint256 id = _createStandardSwap(address(0), 0, 0);
        _setFee(2 ether);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.WrongValue.selector);
        sweeper.acceptSwap{value: 1 ether}(id);
    }

    function test_Fee_ChogHolderPaysNothing() public {
        MockNFT chog = new MockNFT("Chog");
        vm.prank(owner);
        sweeper.setChogCollection(address(chog));
        _setFee(1 ether);
        chog.mint(taker, 1);

        assertEq(sweeper.feeFor(taker), 0);
        assertEq(sweeper.feeFor(stranger), 1 ether);

        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap(id);
        assertEq(sweeper.accruedFees(), 0);
    }

    function test_Fee_ExemptionEndsWhenChogIsSold() public {
        MockNFT chog = new MockNFT("Chog");
        vm.prank(owner);
        sweeper.setChogCollection(address(chog));
        _setFee(1 ether);
        chog.mint(taker, 1);
        vm.prank(taker);
        chog.transferFrom(taker, stranger, 1);
        assertEq(sweeper.feeFor(taker), 1 ether);
    }

    function test_Fee_NonHolderPaysWhileHolderDoesNot_SameBlock() public {
        MockNFT chog = new MockNFT("Chog");
        vm.prank(owner);
        sweeper.setChogCollection(address(chog));
        _setFee(1 ether);
        chog.mint(stranger, 1);

        nftA.mint(maker, 1);
        nftA.mint(maker, 2);
        vm.startPrank(maker);
        uint256 id1 = sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 0, expiry);
        uint256 id2 = sweeper.createSwap(address(0), _assets(nftA, 2, 1), _none(), 0, expiry);
        vm.stopPrank();

        vm.prank(stranger);
        sweeper.acceptSwap(id1);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id2);
        assertEq(sweeper.accruedFees(), 1 ether);
    }

    function test_Fee_PromotionWindowIsInclusive() public {
        _setFee(1 ether);
        uint64 until = uint64(block.timestamp + 1 hours);
        vm.prank(owner);
        sweeper.setFeeWaivedUntil(until);

        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.warp(until);
        assertEq(sweeper.feeFor(taker), 0);
        vm.prank(taker);
        sweeper.acceptSwap(id);

        vm.warp(until + 1);
        assertEq(sweeper.feeFor(taker), 1 ether);
    }

    function test_Fee_PromotionCanBeEndedEarly() public {
        _setFee(1 ether);
        vm.startPrank(owner);
        sweeper.setFeeWaivedUntil(uint64(block.timestamp + 30 days));
        assertEq(sweeper.feeFor(taker), 0);
        sweeper.setFeeWaivedUntil(0);
        vm.stopPrank();
        assertEq(sweeper.feeFor(taker), 1 ether);
    }

    function test_Fee_HostileChogContracts_NeverBlockAcceptance() public {
        _setFee(1 ether);
        address[4] memory hostile = [
            address(new RevertingChog()),
            address(new GasBurnerChog()),
            address(new GarbageChog()),
            makeAddr("eoaAsChog")
        ];
        for (uint256 i; i < hostile.length; ++i) {
            vm.prank(owner);
            sweeper.setChogCollection(hostile[i]);
            assertEq(sweeper.feeFor(taker), 1 ether, "treated as non-holder");
        }

        // Settlement works end to end with the gas burner configured.
        vm.prank(owner);
        sweeper.setChogCollection(hostile[1]);
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id);
        assertEq(nftA.ownerOf(1), taker);
    }

    function test_Fee_GasBurnerCannotConsumeMoreThanProbeBudget() public {
        _setFee(1 ether);
        address burner = address(new GasBurnerChog());
        vm.prank(owner);
        sweeper.setChogCollection(burner);
        uint256 g = gasleft();
        sweeper.feeFor(taker);
        assertLt(g - gasleft(), 80_000);
    }

    function test_Fee_DisabledChogCollectionMeansNoExemption() public {
        MockNFT chog = new MockNFT("Chog");
        chog.mint(taker, 1);
        _setFee(1 ether);
        assertEq(sweeper.feeFor(taker), 1 ether); // collection unset
    }

    function testFuzz_Fee_Accounting(uint128 fee, uint128 wantedMon, uint128 offeredMon) public {
        fee = uint128(bound(fee, 0, sweeper.MAX_PLATFORM_FEE()));
        wantedMon = uint128(bound(wantedMon, 0, 1e24));
        offeredMon = uint128(bound(offeredMon, 0, 1e24));
        _setFee(fee);
        vm.deal(maker, uint256(offeredMon) + 1 ether);
        vm.deal(taker, uint256(wantedMon) + fee + 1 ether);
        nftA.mint(maker, 1);

        uint256 makerBefore = maker.balance;
        uint256 takerBefore = taker.balance;
        vm.prank(maker);
        uint256 id = sweeper.createSwap{value: offeredMon}(taker, _assets(nftA, 1, 1), _none(), wantedMon, expiry);

        vm.prank(taker);
        sweeper.acceptSwap{value: uint256(wantedMon) + fee}(id);

        assertEq(maker.balance, makerBefore - offeredMon + wantedMon);
        assertEq(taker.balance, takerBefore - wantedMon - fee + offeredMon);
        assertEq(sweeper.accruedFees(), fee);
        assertEq(address(sweeper).balance, fee);
    }

    /*------------------------ fee withdrawal ------------------------*/

    function test_WithdrawFees_SendsToTreasury_AnyoneCanTrigger() public {
        _setFee(1 ether);
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id);

        vm.expectEmit(true, false, false, true, address(sweeper));
        emit FeesWithdrawn(treasury, 1 ether);
        vm.prank(stranger);
        sweeper.withdrawFees();

        assertEq(treasury.balance, 1 ether);
        assertEq(sweeper.accruedFees(), 0);
        assertEq(address(sweeper).balance, 0);
    }

    event FeesWithdrawn(address indexed treasury, uint256 amount);

    function test_WithdrawFees_RevertsWhenEmpty() public {
        vm.expectRevert(ChogSweeper.NoFees.selector);
        sweeper.withdrawFees();
    }

    function test_WithdrawFees_RejectingTreasuryCannotBlockTrades() public {
        _setFee(1 ether);
        address rejecter = address(new MonRejecter());
        vm.prank(owner);
        sweeper.setTreasury(rejecter);

        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id); // trading is unaffected

        vm.expectRevert(ChogSweeper.TransferFailed.selector);
        sweeper.withdrawFees();
        assertEq(sweeper.accruedFees(), 1 ether); // fees preserved

        vm.prank(owner);
        sweeper.setTreasury(treasury);
        sweeper.withdrawFees();
        assertEq(treasury.balance, 1 ether);
    }

    function test_WithdrawFees_DoesNotTouchEscrowedMon() public {
        _setFee(1 ether);
        uint256 openId = _createStandardSwap(address(0), 7 ether, 0);

        nftA.mint(maker, 2);
        vm.prank(maker);
        uint256 id2 = sweeper.createSwap(address(0), _assets(nftA, 2, 1), _none(), 0, expiry);
        vm.prank(stranger);
        sweeper.acceptSwap{value: 1 ether}(id2);

        sweeper.withdrawFees();
        assertEq(address(sweeper).balance, 7 ether);
        vm.prank(maker);
        sweeper.cancelSwap(openId);
        assertEq(address(sweeper).balance, 0);
    }

    /*------------------------- fee admin ---------------------------*/

    function test_Admin_OnlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(err);
        sweeper.setPlatformFee(1);
        vm.expectRevert(err);
        sweeper.setFeeWaivedUntil(1);
        vm.expectRevert(err);
        sweeper.setChogCollection(address(1));
        vm.expectRevert(err);
        sweeper.setTreasury(address(1));
        vm.stopPrank();
    }

    function test_Admin_FeeCapAndZeroTreasury() public {
        uint128 tooHigh = uint128(sweeper.MAX_PLATFORM_FEE()) + 1;
        vm.startPrank(owner);
        vm.expectRevert(ChogSweeper.FeeTooHigh.selector);
        sweeper.setPlatformFee(tooHigh);
        vm.expectRevert(ChogSweeper.ZeroAddress.selector);
        sweeper.setTreasury(address(0));
        sweeper.setPlatformFee(uint128(sweeper.MAX_PLATFORM_FEE()));
        vm.stopPrank();
    }

    function test_Admin_TwoStepOwnershipTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        sweeper.transferOwnership(newOwner);
        assertEq(sweeper.owner(), owner); // not yet

        vm.prank(stranger);
        vm.expectRevert();
        sweeper.acceptOwnership();

        vm.prank(newOwner);
        sweeper.acceptOwnership();
        assertEq(sweeper.owner(), newOwner);
    }

    function test_Admin_CannotAlterExistingTradeTerms() public {
        uint256 id = _createStandardSwap(taker, 2 ether, 1 ether);
        _setFee(5 ether);
        (address m, address t,, uint64 exp, uint256 offeredMon, uint256 wantedMon,,) = sweeper.getTrade(id);
        assertEq(m, maker);
        assertEq(t, taker);
        assertEq(exp, expiry);
        assertEq(offeredMon, 2 ether);
        assertEq(wantedMon, 1 ether);
    }

    /*========================= decline =========================*/

    function test_Decline_ReturnsEscrowToMaker() public {
        uint256 makerBefore = maker.balance;
        uint256 id = _createStandardSwap(taker, 4 ether, 1 ether);

        vm.expectEmit(true, true, true, true, address(sweeper));
        emit TradeDeclined(id, maker, taker);
        vm.prank(taker);
        sweeper.declineSwap(id);

        assertEq(nftA.ownerOf(1), maker);
        assertEq(maker.balance, makerBefore);
        assertEq(address(sweeper).balance, 0);
        (,, ChogSweeper.Status status,,,, ChogSweeper.Asset[] memory off,) = sweeper.getTrade(id);
        assertEq(uint8(status), uint8(ChogSweeper.Status.Declined));
        assertEq(off.length, 0);
    }

    function test_Decline_OnlyDesignatedTaker() public {
        uint256 id = _createStandardSwap(taker, 0, 0);
        vm.prank(stranger);
        vm.expectRevert(ChogSweeper.UnauthorizedTaker.selector);
        sweeper.declineSwap(id);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.UnauthorizedTaker.selector);
        sweeper.declineSwap(id);
    }

    function test_Decline_OpenCounterCannotBeDeclined() public {
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.UnauthorizedTaker.selector);
        sweeper.declineSwap(id);
    }

    function test_Decline_AllowedAfterExpiry() public {
        uint256 id = _createStandardSwap(taker, 0, 0);
        vm.warp(uint256(expiry) + 1);
        vm.prank(taker);
        sweeper.declineSwap(id);
        assertEq(nftA.ownerOf(1), maker);
    }

    function test_Decline_TerminalStates() public {
        uint256 id = _createStandardSwap(taker, 0, 0);
        vm.prank(taker);
        sweeper.declineSwap(id);

        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.declineSwap(id);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.acceptSwap(id);
        vm.prank(maker);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.cancelSwap(id);

        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TradeNotFound.selector);
        sweeper.declineSwap(404);
    }

    function test_Decline_NotPossibleAfterAcceptOrCancel() public {
        uint256 id1 = _createStandardSwap(taker, 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap(id1);
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.declineSwap(id1);

        nftA.mint(maker, 2);
        vm.startPrank(maker);
        uint256 id2 = sweeper.createSwap(taker, _assets(nftA, 2, 1), _none(), 0, expiry);
        sweeper.cancelSwap(id2);
        vm.stopPrank();
        vm.prank(taker);
        vm.expectRevert(ChogSweeper.TradeNotActive.selector);
        sweeper.declineSwap(id2);
    }

    /*========================== gifts ==========================*/

    function test_Gift_MonOnlyToOpenCounter_NothingWantedAtAll() public {
        vm.prank(maker);
        uint256 id = sweeper.createSwap{value: 3 ether}(address(0), _none(), _none(), 0, expiry);
        vm.prank(stranger);
        sweeper.acceptSwap(id);
        assertEq(stranger.balance, 1_003 ether);
        assertEq(address(sweeper).balance, 0);
    }

    function test_Gift_WithFee_TakerPaysOnlyTheFee() public {
        _setFee(0.25 ether);
        nftA.mint(maker, 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 0, expiry);

        uint256 before = stranger.balance;
        vm.prank(stranger);
        sweeper.acceptSwap{value: 0.25 ether}(id);
        assertEq(before - stranger.balance, 0.25 ether);
        assertEq(nftA.ownerOf(1), stranger);
    }

    function test_Gift_CancelWorks() public {
        nftA.mint(maker, 1);
        vm.startPrank(maker);
        uint256 id = sweeper.createSwap(address(0), _assets(nftA, 1, 1), _none(), 0, expiry);
        sweeper.cancelSwap(id);
        vm.stopPrank();
        assertEq(nftA.ownerOf(1), maker);
    }

    function test_Request_NftsOnly_ZeroMon() public {
        uint256 id = _createStandardSwap(taker, 1 ether, 0);
        (,,,,, uint256 wantedMon,,) = sweeper.getTrade(id);
        assertEq(wantedMon, 0);
    }

    /*=================== bundles with fees and MON ===================*/

    function test_FullBundle_TenForTen_WithMonAndFee() public {
        _setFee(0.1 ether);
        uint256 max = sweeper.MAX_ASSETS_PER_SIDE();
        _mintRange(nftA, maker, 100, max);
        _mintRange(nftB, taker, 200, max);

        vm.prank(maker);
        uint256 id = sweeper.createSwap{value: 2 ether}(taker, _assets(nftA, 100, max), _assets(nftB, 200, max), 1 ether, expiry);

        uint256 makerBefore = maker.balance;
        vm.prank(taker);
        sweeper.acceptSwap{value: 1.1 ether}(id);

        for (uint256 i; i < max; ++i) {
            assertEq(nftA.ownerOf(100 + i), taker);
            assertEq(nftB.ownerOf(200 + i), maker);
        }
        assertEq(maker.balance, makerBefore + 1 ether);
        assertEq(address(sweeper).balance, 0.1 ether);
    }

    function test_Bundle_PartialFailureIsAtomic() public {
        // Second wanted token is not owned by the taker: nothing may move, no MON may be paid.
        _mintRange(nftB, taker, 300, 1);
        _mintRange(nftB, stranger, 301, 1);
        nftA.mint(maker, 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap{value: 1 ether}(address(0), _assets(nftA, 1, 1), _assets(nftB, 300, 2), 0, expiry);

        uint256 takerBefore = taker.balance;
        vm.prank(taker);
        vm.expectRevert();
        sweeper.acceptSwap(id);

        assertEq(nftB.ownerOf(300), taker);
        assertEq(nftA.ownerOf(1), address(sweeper));
        assertEq(taker.balance, takerBefore);
        assertEq(address(sweeper).balance, 1 ether);
    }

    function test_TradeNotFound_ForUnusedIds() public {
        vm.expectRevert(ChogSweeper.TradeNotFound.selector);
        sweeper.quoteAcceptance(1, taker);
        vm.expectRevert(ChogSweeper.TradeNotFound.selector);
        sweeper.acceptSwap(0);
    }

    /*================= additional reentrancy vectors =================*/

    /// The treasury re-enters `withdrawFees` while receiving its payout.
    function test_Reentrancy_TreasuryReentersWithdrawFees_Blocked() public {
        ReentrantParty evilTreasury = new ReentrantParty(sweeper);
        _setFee(1 ether);
        vm.prank(owner);
        sweeper.setTreasury(address(evilTreasury));

        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id);

        evilTreasury.configure(ReentrantParty.Mode.ReenterWithdraw, 0, true);
        sweeper.withdrawFees();

        assertTrue(evilTreasury.reentryBlocked());
        assertEq(address(evilTreasury).balance, 1 ether); // paid exactly once
        assertEq(sweeper.accruedFees(), 0);
        assertEq(address(sweeper).balance, 0);
    }

    /// Same attack, but the treasury propagates the failure: the whole withdrawal reverts and fees remain.
    function test_Reentrancy_TreasuryPropagatesFailure_FeesPreserved() public {
        ReentrantParty evilTreasury = new ReentrantParty(sweeper);
        _setFee(1 ether);
        vm.prank(owner);
        sweeper.setTreasury(address(evilTreasury));
        uint256 id = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(id);

        evilTreasury.configure(ReentrantParty.Mode.ReenterWithdraw, 0, false);
        vm.expectRevert(ChogSweeper.TransferFailed.selector);
        sweeper.withdrawFees();
        assertEq(sweeper.accruedFees(), 1 ether);
    }

    /// A maker contract re-enters `declineSwap` while receiving its refund.
    function test_Reentrancy_MakerReentersDeclineOnRefund_Blocked() public {
        ReentrantParty evilMaker = new ReentrantParty(sweeper);
        vm.deal(address(evilMaker), 5 ether);
        uint256 id = evilMaker.create{value: 5 ether}(taker, _none(), _assets(nftB, 1, 1), 0, expiry);
        evilMaker.configure(ReentrantParty.Mode.ReenterDecline, id, true);

        vm.prank(taker);
        sweeper.declineSwap(id);

        assertTrue(evilMaker.reentryBlocked());
        assertEq(address(evilMaker).balance, 10 ether); // 5 pre-funded + 5 refunded once
        assertEq(address(sweeper).balance, 0);
    }

    /// A maker contract re-enters `acceptSwap` during a cancel refund; the fee path must not be reachable.
    function test_Reentrancy_MakerReentersAcceptDuringCancel_Blocked() public {
        ReentrantParty evilMaker = new ReentrantParty(sweeper);
        _setFee(1 ether);
        vm.deal(address(evilMaker), 5 ether);
        uint256 id = evilMaker.create{value: 2 ether}(address(0), _none(), _assets(nftB, 1, 1), 0, expiry);
        evilMaker.configure(ReentrantParty.Mode.ReenterAccept, id, true);
        evilMaker.cancel(id);

        assertTrue(evilMaker.reentryBlocked());
        assertEq(sweeper.accruedFees(), 0);
        assertEq(address(sweeper).balance, 0);
    }

    /// A hostile NFT re-enters `declineSwap` while the escrow is being returned to the maker.
    function test_Reentrancy_HostileNftDuringDecline_Blocked() public {
        ReentrantNFT evil = new ReentrantNFT();
        evil.mint(maker, 1);
        vm.prank(maker);
        evil.setApprovalForAll(address(sweeper), true);
        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](1);
        off[0] = ChogSweeper.Asset(address(evil), 1);
        vm.prank(maker);
        uint256 id = sweeper.createSwap(taker, off, _none(), 0, expiry);

        evil.arm(address(sweeper), abi.encodeCall(ChogSweeper.declineSwap, (id)));
        vm.prank(taker);
        sweeper.declineSwap(id);

        assertTrue(evil.blocked());
        assertEq(evil.ownerOf(1), maker);
    }

    /// A hostile Chog collection tries to withdraw fees from inside the `balanceOf` probe.
    /// `staticcall` forbids the state change, so previously accrued fees stay put.
    function test_Reentrancy_ChogProbeCannotChangeState() public {
        _setFee(1 ether);
        uint256 first = _createStandardSwap(address(0), 0, 0);
        vm.prank(taker);
        sweeper.acceptSwap{value: 1 ether}(first); // accrues 1 ether

        ReentrantChog evilChog = new ReentrantChog(sweeper);
        vm.prank(owner);
        sweeper.setChogCollection(address(evilChog));

        nftA.mint(maker, 2);
        vm.prank(maker);
        uint256 second = sweeper.createSwap(address(0), _assets(nftA, 2, 1), _none(), 0, expiry);
        vm.prank(stranger);
        sweeper.acceptSwap(second); // evil collection claims the taker is a holder: fee-free

        assertEq(sweeper.accruedFees(), 1 ether, "withdrawal inside the probe must not succeed");
        assertEq(treasury.balance, 0);
        assertEq(nftA.ownerOf(2), stranger);
    }

}


/*//////////////////////////////////////////////////////////////
                    HOSTILE CHOG COLLECTIONS
//////////////////////////////////////////////////////////////*/

contract RevertingChog {
    fallback() external {
        revert("no");
    }
}

contract GasBurnerChog {
    fallback() external {
        while (true) {}
    }
}

contract GarbageChog {
    fallback() external {
        assembly {
            mstore(0, 0xff)
            return(0, 1) // one byte of returndata
        }
    }
}

/// @dev Tries to mutate ChogSweeper from inside the `balanceOf` probe. `staticcall` makes that impossible.
contract ReentrantChog {
    ChogSweeper immutable sweeper;

    constructor(ChogSweeper s) {
        sweeper = s;
    }

    fallback() external {
        try sweeper.withdrawFees() {} catch {}
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}

/*//////////////////////////////////////////////////////////////
                      SOLVENCY INVARIANT
//////////////////////////////////////////////////////////////*/

contract SolvencyHandler is Test {
    ChogSweeper public immutable sweeper;
    MockNFT public immutable nft;
    address[3] public actors;
    uint256 public ghostEscrowMon;
    uint256 public ghostFeesPaid;
    uint256 internal nextToken = 1;
    uint256[] internal ids;

    constructor(ChogSweeper s, MockNFT n) {
        sweeper = s;
        nft = n;
        for (uint256 i; i < 3; ++i) {
            actors[i] = makeAddr(string.concat("actor", vm.toString(i)));
            vm.deal(actors[i], 1_000_000 ether);
            vm.prank(actors[i]);
            n.setApprovalForAll(address(s), true);
        }
    }

    function create(uint256 actorSeed, uint96 offeredMon, uint96 wantedMon, uint8 directSeed) external {
        address maker = actors[actorSeed % 3];
        address taker = directSeed % 2 == 0 ? address(0) : actors[(actorSeed + 1) % 3];
        offeredMon = uint96(bound(offeredMon, 0, 1_000 ether));
        wantedMon = uint96(bound(wantedMon, 0, 1_000 ether));
        uint256 tokenId = nextToken++;
        nft.mint(maker, tokenId);
        ChogSweeper.Asset[] memory off = new ChogSweeper.Asset[](1);
        off[0] = ChogSweeper.Asset(address(nft), tokenId);
        ChogSweeper.Asset[] memory none = new ChogSweeper.Asset[](0);
        vm.prank(maker);
        try sweeper.createSwap{value: offeredMon}(taker, off, none, wantedMon, uint64(block.timestamp + 1 days)) returns (uint256 id) {
            ids.push(id);
            ghostEscrowMon += offeredMon;
        } catch {}
    }

    function accept(uint256 idSeed, uint256 actorSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address taker = actors[actorSeed % 3];
        (, , , , uint256 offeredMon,,,) = sweeper.getTrade(id);
        uint256 pay;
        try sweeper.quoteAcceptance(id, taker) returns (uint256 q) {
            pay = q;
        } catch {
            return;
        }
        uint256 fee = sweeper.feeFor(taker);
        vm.prank(taker);
        try sweeper.acceptSwap{value: pay}(id) {
            ghostEscrowMon -= offeredMon;
            ghostFeesPaid += fee;
        } catch {}
    }

    function cancel(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        (address maker,,,, uint256 offeredMon,,,) = sweeper.getTrade(id);
        vm.prank(maker);
        try sweeper.cancelSwap(id) {
            ghostEscrowMon -= offeredMon;
        } catch {}
    }

    function decline(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        (, address taker,,, uint256 offeredMon,,,) = sweeper.getTrade(id);
        vm.prank(taker);
        try sweeper.declineSwap(id) {
            ghostEscrowMon -= offeredMon;
        } catch {}
    }

    function withdraw() external {
        try sweeper.withdrawFees() {} catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 2 days));
    }
}

contract ChogSweeperInvariantTest is Test {
    ChogSweeper internal sweeper;
    SolvencyHandler internal handler;
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        sweeper = new ChogSweeper(address(this), treasury, 0.05 ether);
        MockNFT nft = new MockNFT("Inv");
        handler = new SolvencyHandler(sweeper, nft);
        targetContract(address(handler));
    }

    /// The contract always holds exactly the escrowed MON of active trades plus un-withdrawn fees.
    function invariant_BalanceEqualsEscrowPlusFees() public view {
        assertEq(address(sweeper).balance, handler.ghostEscrowMon() + sweeper.accruedFees());
    }

    /// Every fee a taker paid is either still accrued or has reached the treasury: none is lost or minted.
    function invariant_FeesConserved() public view {
        assertEq(handler.ghostFeesPaid(), sweeper.accruedFees() + treasury.balance);
    }
}


/*//////////////////////////////////////////////////////////////
                         GAS BENCHMARKS
//////////////////////////////////////////////////////////////*/

/// @dev Everything a measured call touches is created in `setUp`, so each call starts from committed, cold
///      state like a real transaction. Minting or creating in the same transaction as the measured call
///      would make storage slots warm/dirty and report numbers no user would ever see.
///
///      Token layout (maker owns nftA 1..60, taker owns nftB 1..60):
///        pre-created trades: 1-for-1 direct (A1,B1), MON-only, 10-for-10 + MON (A2-11,B2-11),
///        cancel-me (A12-21 + MON), decline-me (A22-31 + MON), gift for the fee withdrawal (A32).
///        Fresh tokens for `create` benchmarks: A33..A60.
contract ChogSweeperGasTest is Test {
    ChogSweeper internal sweeper;
    MockNFT internal nftA;
    MockNFT internal nftB;
    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    uint64 internal expiry;

    uint256 internal idOneForOne;
    uint256 internal idMonOnly;
    uint256 internal idTenForTen;
    uint256 internal idCancel;
    uint256 internal idDecline;
    uint256 internal idGift;

    function setUp() public {
        sweeper = new ChogSweeper(owner, treasury, 0.1 ether);
        nftA = new MockNFT("A");
        nftB = new MockNFT("B");
        expiry = uint64(block.timestamp + 1 days);
        vm.deal(maker, 100 ether);
        vm.deal(taker, 100 ether);
        for (uint256 i = 1; i <= 60; ++i) {
            nftA.mint(maker, i);
            nftB.mint(taker, i);
        }
        vm.prank(maker);
        nftA.setApprovalForAll(address(sweeper), true);
        vm.prank(taker);
        nftB.setApprovalForAll(address(sweeper), true);

        vm.startPrank(maker);
        idOneForOne = sweeper.createSwap(taker, _assets(nftA, 1, 1), _assets(nftB, 1, 1), 0, expiry);
        idMonOnly = sweeper.createSwap{value: 1 ether}(address(0), _none(), _none(), 1 ether, expiry);
        idTenForTen = sweeper.createSwap{value: 1 ether}(taker, _assets(nftA, 2, 10), _assets(nftB, 2, 10), 1 ether, expiry);
        idCancel = sweeper.createSwap{value: 1 ether}(address(0), _assets(nftA, 12, 10), _none(), 0, expiry);
        idDecline = sweeper.createSwap{value: 1 ether}(taker, _assets(nftA, 22, 10), _none(), 0, expiry);
        idGift = sweeper.createSwap(address(0), _assets(nftA, 32, 1), _none(), 0, expiry);
        vm.stopPrank();
    }

    function _assets(MockNFT nft, uint256 start, uint256 count) internal pure returns (ChogSweeper.Asset[] memory a) {
        a = new ChogSweeper.Asset[](count);
        for (uint256 i; i < count; ++i) {
            a[i] = ChogSweeper.Asset(address(nft), start + i);
        }
    }

    function _none() internal pure returns (ChogSweeper.Asset[] memory a) {
        a = new ChogSweeper.Asset[](0);
    }

    function _check(string memory label, uint256 used, uint256 budget) internal pure {
        console2.log(label, used);
        require(used < budget, string.concat("gas budget exceeded: ", label));
    }

    // ------------------------------- settlement -------------------------------

    function test_Gas_Accept_OneForOne_WithFee() public {
        vm.prank(taker);
        uint256 g = gasleft();
        sweeper.acceptSwap{value: 0.1 ether}(idOneForOne);
        _check("accept 1-for-1 (+fee)", g - gasleft(), 200_000);
    }

    function test_Gas_Accept_MonForMon_WithFee() public {
        vm.prank(taker);
        uint256 g = gasleft();
        sweeper.acceptSwap{value: 1.1 ether}(idMonOnly);
        _check("accept MON-for-MON (+fee)", g - gasleft(), 115_000);
    }

    function test_Gas_Accept_TenForTen_PlusMon_WithFee() public {
        vm.prank(taker);
        uint256 g = gasleft();
        sweeper.acceptSwap{value: 1.1 ether}(idTenForTen);
        _check("accept 10-for-10 + MON (+fee)", g - gasleft(), 680_000);
    }

    function test_Gas_Accept_FeeFreeForChogHolder() public {
        MockNFT chog = new MockNFT("Chog");
        chog.mint(taker, 1);
        vm.prank(owner);
        sweeper.setChogCollection(address(chog));
        vm.prank(taker);
        uint256 g = gasleft();
        sweeper.acceptSwap(idOneForOne);
        _check("accept 1-for-1 (Chog holder, no fee)", g - gasleft(), 160_000);
    }

    function test_Gas_Cancel_TenNftsPlusMon() public {
        vm.prank(maker);
        uint256 g = gasleft();
        sweeper.cancelSwap(idCancel);
        _check("cancel 10 NFTs + MON", g - gasleft(), 310_000);
    }

    function test_Gas_Decline_TenNftsPlusMon() public {
        vm.prank(taker);
        uint256 g = gasleft();
        sweeper.declineSwap(idDecline);
        _check("decline 10 NFTs + MON", g - gasleft(), 315_000);
    }

    function test_Gas_WithdrawFees() public {
        vm.prank(taker);
        sweeper.acceptSwap{value: 0.1 ether}(idGift);
        vm.roll(block.number + 1);
        uint256 g = gasleft();
        sweeper.withdrawFees();
        _check("withdrawFees", g - gasleft(), 50_000);
    }

    // --------------------------------- create ---------------------------------

    /// Each size runs in its own test so every run starts cold. The budget is `BASE + n * PER_TOKEN`:
    /// a quadratic regression in any loop breaks the n=10 case first.
    uint256 internal constant CREATE_BASE = 160_000;
    uint256 internal constant CREATE_PER_TOKEN = 115_000;

    function _createGas(uint256 n) internal {
        ChogSweeper.Asset[] memory off = _assets(nftA, 33, n);
        ChogSweeper.Asset[] memory want = _assets(nftB, 33, n);
        vm.prank(maker);
        uint256 g = gasleft();
        sweeper.createSwap{value: 1 ether}(address(0), off, want, 1 ether, expiry);
        uint256 used = g - gasleft();
        console2.log("create, NFTs each side:", n, used);
        assertLt(used, CREATE_BASE + n * CREATE_PER_TOKEN, "create gas grew faster than linear");
    }

    function test_Gas_Create_1() public { _createGas(1); }
    function test_Gas_Create_2() public { _createGas(2); }
    function test_Gas_Create_5() public { _createGas(5); }
    function test_Gas_Create_10() public { _createGas(10); }
}
