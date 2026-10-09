// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title MockChog
/// @notice TESTNET ONLY stand-in for the Chog collection, used for end-to-end testing of ChogSweeper.
/// @dev Anyone can mint (capped per call), ids are sequential from 1, and `tokenURI` is fully on-chain
///      (base64 JSON with an inline SVG and traits), so the metadata pipeline can be exercised without
///      IPFS or any external host. Never deploy this to mainnet or treat its tokens as valuable.
contract MockChog is ERC721Enumerable {
    using Strings for uint256;

    /// @notice Most tokens a single `mintBatch` call can create.
    uint256 public constant MAX_BATCH = 10;

    /// @notice Id of the next token to be minted.
    uint256 public nextId = 1;

    error InvalidBatchSize();

    string[4] private _hats = ["None", "Crown", "Cap", "Halo"];
    string[4] private _eyes = ["Chill", "Laser", "Sleepy", "Wide"];
    string[4] private _moods = ["Happy", "Grumpy", "Sleepy", "Hyped"];

    constructor() ERC721("Mock Chog", "MCHOG") {}

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

    /// @notice Deterministic traits derived from the token id.
    function traitsOf(uint256 id) public view returns (string memory hat, string memory eyes, string memory mood) {
        hat = _hats[id % 4];
        eyes = _eyes[(id / 4) % 4];
        mood = _moods[(id / 16) % 4];
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        (string memory hat, string memory eyes, string memory mood) = traitsOf(id);
        string memory json = string.concat(
            '{"name":"Mock Chog #',
            id.toString(),
            '","description":"Test Chog for ChogSweeper. Testnet only, worthless.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(id))),
            '","attributes":[{"trait_type":"Hat","value":"',
            hat,
            '"},{"trait_type":"Eyes","value":"',
            eyes,
            '"},{"trait_type":"Mood","value":"',
            mood,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _svg(uint256 id) private pure returns (string memory) {
        uint256 hue = 245 + (id * 37) % 50; // violet range, one tint per token
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='hsl(",
            hue.toString(),
            " 80% 90%)'/><circle cx='100' cy='92' r='52' fill='hsl(",
            hue.toString(),
            " 65% 62%)'/><circle cx='80' cy='84' r='7' fill='#1C1536'/><circle cx='120' cy='84' r='7' fill='#1C1536'/>",
            "<path d='M78 110 Q100 128 122 110' stroke='#1C1536' stroke-width='5' fill='none' stroke-linecap='round'/>",
            "<text x='100' y='182' font-size='22' font-family='sans-serif' text-anchor='middle' fill='#1C1536'>Chog #",
            id.toString(),
            "</text></svg>"
        );
    }
}
