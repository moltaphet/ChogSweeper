// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {TestArtworkCollection} from "../src/TestArtworkCollection.sol";
import {ChogSweeper} from "../src/ChogSweeper.sol";

contract TestArtworkCollectionTest is Test {
    TestArtworkCollection internal nft;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.chainId(10143);
        nft = new TestArtworkCollection("Test The Bobs", "TBOB", "https://assets.example/collections/the-bobs/");
    }

    function test_ClaimMintsThreeEnumerableTokensToCaller() public {
        vm.prank(alice);
        assertEq(nft.claim(), 1);
        assertEq(nft.balanceOf(alice), 3);
        assertEq(nft.tokenOfOwnerByIndex(alice, 2), 3);
        assertTrue(nft.claimed(alice));
        vm.prank(bob);
        assertEq(nft.claim(), 4);
        assertEq(nft.totalSupply(), 6);
    }

    function test_TransferringAwayTokensDoesNotResetClaim() public {
        vm.startPrank(alice);
        nft.claim();
        nft.transferFrom(alice, bob, 1);
        vm.expectRevert(TestArtworkCollection.AlreadyClaimed.selector);
        nft.claim();
        vm.stopPrank();
    }

    function test_MetadataUsesSuppliedArtworkAndWrapsAfterTen() public {
        for (uint256 i = 1; i <= 4; ++i) {
            vm.prank(address(uint160(i)));
            nft.claim();
        }
        string memory uri = nft.tokenURI(11);
        bytes memory encoded = bytes(uri);
        bytes memory payload = new bytes(encoded.length - 29);
        for (uint256 i; i < payload.length; ++i) {
            payload[i] = encoded[i + 29];
        }
        string memory json = string(Base64.decode(string(payload)));
        assertEq(vm.parseJsonString(json, ".image"), "https://assets.example/collections/the-bobs/01.webp");
        assertEq(vm.parseJsonString(json, ".name"), "Test The Bobs #11");
        vm.expectRevert();
        nft.tokenURI(99);
    }

    function test_RejectsMainnetAndInvalidImageHost() public {
        vm.expectRevert(TestArtworkCollection.InvalidImageBaseURI.selector);
        new TestArtworkCollection("Test", "T", "http://localhost/");
        vm.chainId(143);
        vm.expectRevert(TestArtworkCollection.TestnetOnly.selector);
        new TestArtworkCollection("Test", "T", "https://assets.example/");
    }

    function test_ClaimedTokensCanBeEscrowedAndSwapped() public {
        ChogSweeper sweeper = new ChogSweeper(address(this), address(this), 0);
        address[] memory verified = new address[](1);
        verified[0] = address(nft);
        sweeper.setVerifiedCollections(verified, true);
        vm.startPrank(alice);
        nft.claim();
        nft.setApprovalForAll(address(sweeper), true);
        ChogSweeper.Asset[] memory offered = new ChogSweeper.Asset[](1);
        offered[0] = ChogSweeper.Asset(address(nft), 1);
        ChogSweeper.Asset[] memory wanted = new ChogSweeper.Asset[](0);
        sweeper.createSwap(bob, offered, wanted, 0, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        vm.prank(bob);
        sweeper.acceptSwap(1);
        assertEq(nft.ownerOf(1), bob);
    }
}
