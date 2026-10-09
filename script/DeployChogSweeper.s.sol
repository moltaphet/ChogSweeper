// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChogSweeper} from "../src/ChogSweeper.sol";
import {MockChog} from "../src/MockChog.sol";

/// @title DeployChogSweeper
/// @notice Deploys ChogSweeper (and optionally MockChog) and wires the fee exemption.
///
/// Environment (all read from the shell or `.env`; see `.env.example`):
///   PRIVATE_KEY          required  deployer key (also the initial owner)
///   EXPECTED_CHAIN_ID    optional  default 10143 (Monad Testnet); the script reverts on any other chain
///   PLATFORM_FEE_WEI     optional  flat taker fee in wei, default 0. 0.05 MON = 50000000000000000
///   TREASURY_ADDRESS     optional  fee recipient, default deployer
///   OWNER_ADDRESS        optional  final owner, default deployer. If different, ownership transfer is STARTED
///                                  (Ownable2Step) and must be accepted by that address.
///   CHOG_COLLECTION      optional  an existing Chog contract to use for the fee exemption
///   DEPLOY_MOCK_CHOG     optional  true/false. Default: true when CHOG_COLLECTION is unset, otherwise false
///   SEED_MINT_TO         optional  comma separated addresses to mint mock Chogs to
///   SEED_MINT_COUNT      optional  how many mock Chogs each SEED_MINT_TO address receives (default 1, max 10)
///
/// Run (broadcast):  forge script script/DeployChogSweeper.s.sol --rpc-url $MONAD_TESTNET_RPC_URL --broadcast
/// Dry run:          the same command without --broadcast simulates against the live RPC and sends nothing.
contract DeployChogSweeper is Script {
    uint256 internal constant MONAD_TESTNET = 10143;
    uint256 internal constant ANVIL = 31337;

    error WrongChain(uint256 expected, uint256 actual);
    error MockNotAllowedHere(uint256 chainId);
    error FeeTooHighForConfig();

    function run() external returns (ChogSweeper sweeper, address chog) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        uint256 expectedChain = vm.envOr("EXPECTED_CHAIN_ID", MONAD_TESTNET);
        if (block.chainid != expectedChain) revert WrongChain(expectedChain, block.chainid);

        uint256 fee = vm.envOr("PLATFORM_FEE_WEI", uint256(0));
        if (fee > type(uint128).max) revert FeeTooHighForConfig();
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address finalOwner = vm.envOr("OWNER_ADDRESS", deployer);
        chog = vm.envOr("CHOG_COLLECTION", address(0));
        bool deployMock = vm.envOr("DEPLOY_MOCK_CHOG", chog == address(0));

        // A faucet-style mint contract has no business anywhere but a test network.
        if (deployMock && block.chainid != MONAD_TESTNET && block.chainid != ANVIL) revert MockNotAllowedHere(block.chainid);

        address[] memory seedTo = vm.envOr("SEED_MINT_TO", ",", new address[](0));
        uint256 seedCount = vm.envOr("SEED_MINT_COUNT", uint256(1));

        console2.log("Deployer:        ", deployer);
        console2.log("Chain id:        ", block.chainid);
        console2.log("Treasury:        ", treasury);
        console2.log("Platform fee wei:", fee);

        vm.startBroadcast(deployerKey);

        if (deployMock) {
            MockChog mock = new MockChog();
            chog = address(mock);
            for (uint256 i; i < seedTo.length; ++i) {
                if (seedCount > 0) mock.mintBatch(seedTo[i], seedCount);
            }
        }

        // The deployer owns the contract while it is configured; handover (if any) comes last.
        sweeper = new ChogSweeper(deployer, treasury, uint128(fee));
        if (chog != address(0)) sweeper.setChogCollection(chog);
        if (finalOwner != deployer) sweeper.transferOwnership(finalOwner);

        vm.stopBroadcast();

        console2.log("ChogSweeper:     ", address(sweeper));
        console2.log("Chog collection: ", chog);
        console2.log("Mock Chog:       ", deployMock);
        if (finalOwner != deployer) console2.log("Ownership pending; must be accepted by:", finalOwner);
    }
}
