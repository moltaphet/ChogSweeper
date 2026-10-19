// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChogSweeper} from "../src/ChogSweeper.sol";
import {TestArtworkCollection} from "../src/TestArtworkCollection.sol";

/// @notice Deploy three test replicas and verify them for the existing escrow. Requires a public HTTPS artwork host.
contract DeployArtworkCollections is Script {
    function run() external returns (address[] memory deployed) {
        require(block.chainid == 10143 || block.chainid == 31337, "Testnet only");
        uint256 key = vm.envUint("PRIVATE_KEY");
        ChogSweeper sweeper = ChogSweeper(vm.envAddress("SWEEPER_ADDRESS"));
        require(sweeper.owner() == vm.addr(key), "Broadcaster must own the escrow");
        string memory base = vm.envString("ARTWORK_BASE_URL");
        bytes memory raw = bytes(base);
        require(raw.length > 8, "Set ARTWORK_BASE_URL to a public HTTPS origin");
        if (raw[raw.length - 1] != "/") base = string.concat(base, "/");
        string[3] memory names = ["Test r3tards", "Test skrumpeys", "Test The Bobs"];
        string[3] memory symbols = ["TR3T", "TSKR", "TBOB"];
        string[3] memory slugs = ["r3tards", "skrumpeys", "the-bobs"];
        deployed = new address[](3);
        vm.startBroadcast(key);
        for (uint256 i; i < 3; ++i) {
            TestArtworkCollection c =
                new TestArtworkCollection(names[i], symbols[i], string.concat(base, "collections/", slugs[i], "/"));
            deployed[i] = address(c);
            console2.log(names[i], address(c));
        }
        sweeper.setVerifiedCollections(deployed, true);
        vm.stopBroadcast();
    }
}
