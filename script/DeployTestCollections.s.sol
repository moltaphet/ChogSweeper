// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChogSweeper} from "../src/ChogSweeper.sol";
import {MockCollection} from "../src/MockCollection.sol";

/// @title DeployTestCollections
/// @notice TESTNET ONLY. Deploys a few mock partner collections, mints some tokens of each to the given wallets and adds them
///         to the already deployed ChogSweeper's verified list (the broadcaster must be its owner).
///
/// Environment:
///   PRIVATE_KEY       required  the ChogSweeper owner's key
///   SWEEPER_ADDRESS   required  the deployed ChogSweeper
///   SEED_MINT_TO      optional  comma separated wallets that receive tokens of every collection
///   SEED_MINT_COUNT   optional  tokens per wallet per collection (default 5, max 10)
///
/// Run:  forge script script/DeployTestCollections.s.sol --rpc-url $MONAD_TESTNET_RPC_URL --broadcast
contract DeployTestCollections is Script {
    uint256 internal constant MONAD_TESTNET = 10143;
    uint256 internal constant ANVIL = 31337;

    error TestnetOnly(uint256 chainId);

    function run() external returns (address[] memory deployed) {
        if (block.chainid != MONAD_TESTNET && block.chainid != ANVIL) revert TestnetOnly(block.chainid);
        uint256 key = vm.envUint("PRIVATE_KEY");
        ChogSweeper sweeper = ChogSweeper(vm.envAddress("SWEEPER_ADDRESS"));
        address[] memory seedTo = vm.envOr("SEED_MINT_TO", ",", new address[](0));
        uint256 seedCount = vm.envOr("SEED_MINT_COUNT", uint256(5));

        string[4] memory names = ["Mock Molandak", "Mock Moyaki", "Mock Chewy", "Mock Mop"];
        string[4] memory symbols = ["MMOLA", "MMOYA", "MCHEWY", "MMOP"];
        uint256[4] memory hues = [uint256(150), 20, 195, 330];

        deployed = new address[](names.length);
        vm.startBroadcast(key);
        for (uint256 i; i < names.length; ++i) {
            MockCollection c = new MockCollection(names[i], symbols[i], hues[i]);
            for (uint256 j; j < seedTo.length; ++j) {
                if (seedCount > 0) c.mintBatch(seedTo[j], seedCount);
            }
            deployed[i] = address(c);
            console2.log(names[i], address(c));
        }
        sweeper.setVerifiedCollections(deployed, true);
        vm.stopBroadcast();
    }
}
