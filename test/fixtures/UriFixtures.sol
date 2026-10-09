// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice TEST FIXTURE: an ERC-721 whose token URIs are whatever the caller says, to rehearse the metadata pipeline
///         against real-world URI shapes (ipfs://, ar://, https, data:, relative paths, raw JSON).
contract UriNFT is ERC721 {
    mapping(uint256 => string) private _uris;

    constructor() ERC721("Uri Fixture", "URI") {}

    function mintWithUri(address to, uint256 id, string calldata uri_) external {
        _mint(to, id);
        _uris[id] = uri_;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return _uris[id];
    }
}

/// @notice TEST FIXTURE: ERC-1155 style, `uri(id)` only (no `tokenURI`, no `ownerOf`).
contract Uri1155Like {
    mapping(uint256 => string) private _uris;

    function set(uint256 id, string calldata uri_) external {
        _uris[id] = uri_;
    }

    function uri(uint256 id) external view returns (string memory) {
        return _uris[id];
    }
}
