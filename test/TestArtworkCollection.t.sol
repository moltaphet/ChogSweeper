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

    function test_MintsRepeatedBatchesAndTracksEnumerableOwnership() public {
        vm.prank(alice);
        assertEq(nft.mintBatch(alice, 3), 1);
        vm.prank(alice);
        assertEq(nft.mintBatch(alice, 2), 4);
        assertEq(nft.balanceOf(alice), 5);
        assertEq(nft.tokenOfOwnerByIndex(alice, 4), 5);
        vm.prank(bob);
        assertEq(nft.mintBatch(bob, 2), 6);
        assertEq(nft.totalSupply(), 7);
    }

    function test_MintCanBeRepeatedAfterTransferringTokensAway() public {
        vm.startPrank(alice);
        nft.mintBatch(alice, 3);
        nft.transferFrom(alice, bob, 1);
        assertEq(nft.mintBatch(alice, 2), 4);
        assertEq(nft.balanceOf(alice), 4);
        vm.stopPrank();
    }

    function test_RejectsInvalidMintBatchSizes() public {
        uint256 tooMany = nft.MAX_BATCH() + 1;
        vm.expectRevert(TestArtworkCollection.InvalidBatchSize.selector);
        nft.mintBatch(alice, 0);
        vm.expectRevert(TestArtworkCollection.InvalidBatchSize.selector);
        nft.mintBatch(alice, tooMany);
        vm.expectRevert(TestArtworkCollection.InvalidBatchSize.selector);
        nft.mintBatch(address(0), 1);
    }

    function test_MetadataUsesSuppliedArtworkAndWrapsAfterTen() public {
        for (uint256 i = 1; i <= 4; ++i) {
            vm.prank(address(uint160(i)));
            nft.mintBatch(address(uint160(i)), 3);
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
        nft.mintBatch(alice, 3);
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
