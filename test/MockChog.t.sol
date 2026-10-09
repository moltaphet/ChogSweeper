// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {MockChog} from "../src/MockChog.sol";
import {ChogSweeper} from "../src/ChogSweeper.sol";

contract MockChogTest is Test {
    MockChog internal chog;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        chog = new MockChog();
    }

    function test_MintIsSequentialFromOne() public {
        assertEq(chog.mint(alice), 1);
        assertEq(chog.mint(bob), 2);
        assertEq(chog.ownerOf(1), alice);
        assertEq(chog.ownerOf(2), bob);
        assertEq(chog.nextId(), 3);
    }

    function test_MintBatch_ReturnsFirstId_AndEnforcesBounds() public {
        assertEq(chog.mintBatch(alice, 3), 1);
        assertEq(chog.mintBatch(alice, 2), 4);
        assertEq(chog.balanceOf(alice), 5);
        vm.expectRevert(MockChog.InvalidBatchSize.selector);
        chog.mintBatch(alice, 0);
        vm.expectRevert(MockChog.InvalidBatchSize.selector);
        chog.mintBatch(alice, 11);
    }

    function test_Enumerable_ListsOwnedTokens() public {
        chog.mintBatch(alice, 3);
        chog.mint(bob);
        assertEq(chog.balanceOf(alice), 3);
        assertEq(chog.tokenOfOwnerByIndex(alice, 0), 1);
        assertEq(chog.tokenOfOwnerByIndex(alice, 2), 3);
        assertEq(chog.tokenByIndex(3), 4);
        assertEq(chog.totalSupply(), 4);
    }

    function test_TokenURI_IsOnChainJsonWithImageAndTraits() public {
        chog.mint(alice);
        string memory uri = chog.tokenURI(1);

        string memory jsonPrefix = "data:application/json;base64,";
        assertEq(_slice(uri, 0, bytes(jsonPrefix).length), jsonPrefix);

        string memory json = string(_decode(_after(uri, bytes(jsonPrefix).length)));
        assertTrue(_contains(json, '"name":"Mock Chog #1"'));
        assertTrue(_contains(json, '"trait_type":"Hat","value":"Crown"')); // 1 % 4 = 1
        assertTrue(_contains(json, '"trait_type":"Eyes","value":"Chill"'));
        assertTrue(_contains(json, '"trait_type":"Mood","value":"Happy"'));
        assertTrue(_contains(json, '"image":"data:image/svg+xml;base64,'));
    }

    function test_TokenURI_ImageIsAValidSvgForEveryTrait() public {
        chog.mintBatch(alice, 10);
        for (uint256 id = 1; id <= 10; ++id) {
            string memory json = string(_decode(_after(chog.tokenURI(id), 29)));
            uint256 start = _indexOf(json, "base64,") + 7;
            uint256 end = _indexOf(json, '","attributes"');
            string memory svg = string(_decode(_slice(json, start, end - start)));
            assertTrue(_contains(svg, "<svg"));
            assertTrue(_contains(svg, string.concat("Chog #", vm.toString(id))));
        }
    }

    function test_TokenURI_RevertsForUnmintedToken() public {
        vm.expectRevert();
        chog.tokenURI(99);
    }

    function test_TraitsAreDeterministic() public view {
        (string memory h1, string memory e1, string memory m1) = chog.traitsOf(21);
        (string memory h2, string memory e2, string memory m2) = chog.traitsOf(21);
        assertEq(h1, h2);
        assertEq(e1, e2);
        assertEq(m1, m2);
    }

    /// The point of the mock: a real ERC-721 `balanceOf` drives ChogSweeper's holder fee exemption.
    function test_WorksAsChogCollectionForFeeExemption() public {
        address owner = makeAddr("owner");
        ChogSweeper sweeper = new ChogSweeper(owner, makeAddr("treasury"), 0.05 ether);
        vm.prank(owner);
        sweeper.setChogCollection(address(chog));

        assertEq(sweeper.feeFor(alice), 0.05 ether);
        chog.mint(alice);
        assertEq(sweeper.feeFor(alice), 0);
        assertEq(sweeper.feeFor(bob), 0.05 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _decode(string memory b64) private pure returns (bytes memory out) {
        bytes memory data = bytes(b64);
        bytes memory table = bytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
        uint256 pad = data.length > 0 && data[data.length - 1] == "=" ? (data.length > 1 && data[data.length - 2] == "=" ? 2 : 1) : 0;
        out = new bytes(data.length / 4 * 3 - pad);
        uint256 o;
        for (uint256 i; i < data.length; i += 4) {
            uint256 n;
            for (uint256 j; j < 4; ++j) {
                uint8 c = uint8(data[i + j]);
                uint256 v;
                if (c == 0x3d) {
                    v = 0;
                } else {
                    for (uint256 k; k < 64; ++k) {
                        if (uint8(table[k]) == c) {
                            v = k;
                            break;
                        }
                    }
                }
                n = (n << 6) | v;
            }
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
    }

    function _slice(string memory s, uint256 start, uint256 len) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory r = new bytes(len);
        for (uint256 i; i < len; ++i) r[i] = b[start + i];
        return string(r);
    }

    function _after(string memory s, uint256 start) private pure returns (string memory) {
        return _slice(s, start, bytes(s).length - start);
    }

    function _indexOf(string memory hay, string memory needle) private pure returns (uint256) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return i;
        }
        revert("not found");
    }

    function _contains(string memory hay, string memory needle) private pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
