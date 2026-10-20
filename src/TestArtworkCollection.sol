// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Test replicas with supplied sample art, separate from the original NFT collections.
/// @dev Testnet only. Anyone can mint repeatedly in batches; artwork cycles through 01.webp..10.webp.
contract TestArtworkCollection is ERC721Enumerable {
    using Strings for uint256;

    uint256 public constant MAX_BATCH = 10;
    uint256 public nextId = 1;
    string public imageBaseURI;

    error TestnetOnly();
    error InvalidBatchSize();
    error InvalidImageBaseURI();

    constructor(string memory name_, string memory symbol_, string memory imageBaseURI_) ERC721(name_, symbol_) {
        if (block.chainid != 10143 && block.chainid != 31337) revert TestnetOnly();
        bytes memory base = bytes(imageBaseURI_);
        if (base.length < 9 || bytes8(base) != bytes8("https://") || base[base.length - 1] != "/") {
            revert InvalidImageBaseURI();
        }
        for (uint256 i; i < base.length; ++i) {
            if (base[i] == '"' || base[i] == "\\" || uint8(base[i]) < 33) revert InvalidImageBaseURI();
        }
        imageBaseURI = imageBaseURI_;
    }

    /// @notice Mints practice NFTs to `to`; no mint price (only network gas). Repeat as often as desired.
    function mintBatch(address to, uint256 count) external returns (uint256 firstId) {
        if (to == address(0) || count == 0 || count > MAX_BATCH) revert InvalidBatchSize();
        firstId = nextId;
        nextId += count;
        for (uint256 i; i < count; ++i) {
            _safeMint(to, firstId + i);
        }
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        uint256 variant = ((id - 1) % 10) + 1;
        string memory file = string.concat(variant < 10 ? "0" : "", variant.toString(), ".webp");
        bytes memory json = abi.encodePacked(
            '{"name":"',
            name(),
            " #",
            id.toString(),
            '","description":"ChogSweeper test replica. No monetary value. Separate from the original collection.","image":"',
            imageBaseURI,
            file,
            '","attributes":[{"trait_type":"Network","value":"Testnet"},{"trait_type":"Artwork variant","value":"',
            variant.toString(),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
