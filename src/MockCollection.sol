// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title MockCollection
/// @notice TESTNET ONLY stand-in for a partner NFT collection, used to try ChogSweeper with more than one collection.
/// @dev Anyone can mint (capped per call), ids are sequential from 1 and `tokenURI` is fully on-chain (base64 JSON with an
///      inline SVG tinted by the collection's hue). Never deploy this to mainnet or treat its tokens as valuable.
contract MockCollection is ERC721Enumerable {
    using Strings for uint256;

    /// @notice Most tokens a single `mintBatch` call can create.
    uint256 public constant MAX_BATCH = 10;

    /// @notice Id of the next token to be minted.
    uint256 public nextId = 1;

    /// @notice Base colour of this collection's artwork (0..359).
    uint256 public immutable hue;

    error InvalidBatchSize();

    constructor(string memory name_, string memory symbol_, uint256 hue_) ERC721(name_, symbol_) {
        hue = hue_ % 360;
    }

    /// @notice Mint one token to `to` and return its id.
    function mint(address to) external returns (uint256 id) {
        id = nextId++;
        _mint(to, id);
    }

    /// @notice Mint `count` (1..MAX_BATCH) tokens to `to`; returns the first id.
    function mintBatch(address to, uint256 count) external returns (uint256 firstId) {
        if (count == 0 || count > MAX_BATCH) revert InvalidBatchSize();
        firstId = nextId;
        for (uint256 i; i < count; ++i) {
            _mint(to, nextId++);
        }
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        string memory label = string.concat(name(), " #", id.toString());
        string memory json = string.concat(
            '{"name":"',
            label,
            '","description":"Test token from a mock collection. Testnet only, worthless.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(id, label))),
            '","attributes":[{"trait_type":"Collection","value":"',
            name(),
            '"},{"trait_type":"Shade","value":"',
            ((id * 7) % 5).toString(),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _svg(uint256 id, string memory label) private view returns (string memory) {
        uint256 h = (hue + (id * 11) % 40) % 360; // a few shades per collection
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='hsl(",
            h.toString(),
            " 85% 88%)'/><rect x='40' y='40' width='120' height='120' rx='28' fill='hsl(",
            h.toString(),
            " 70% 55%)'/><circle cx='80' cy='92' r='8' fill='#1C1536'/><circle cx='120' cy='92' r='8' fill='#1C1536'/>",
            "<path d='M78 122 Q100 140 122 122' stroke='#1C1536' stroke-width='5' fill='none' stroke-linecap='round'/>",
            "<text x='100' y='186' font-size='14' font-family='sans-serif' text-anchor='middle' fill='#1C1536'>",
            label,
            "</text></svg>"
        );
    }
}
