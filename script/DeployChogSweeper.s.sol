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
///   CHOG_COLLECTION      optional  an existing Chog contract to use for the fee exemption (also added to the verified list)
///   PARTNER_COLLECTION   optional  partner collection: 25% off the fee per token held, up to 4 (also verified)
///   TRADEABLE_COLLECTIONS optional  comma separated extra collections that may be traded. ONLY these (plus Chog and the
///                                  partner) can appear in a trade; the owner can change the list later
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

    /// @dev Everything read from the environment, kept in one struct so `run` stays within the stack limit.
    struct Config {
        address deployer;
        address treasury;
        address finalOwner;
        address chog;
        address partner;
        uint256 fee;
        bool deployMock;
    }

    function run() external returns (ChogSweeper sweeper, address chog) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        Config memory c = _readConfig(vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);

        if (c.deployMock) c.chog = _deployMock();

        // The deployer owns the contract while it is configured; handover (if any) comes last.
        sweeper = new ChogSweeper(c.deployer, c.treasury, uint128(c.fee));
        if (c.chog != address(0)) sweeper.setChogCollection(c.chog);
        if (c.partner != address(0)) sweeper.setPartnerCollection(c.partner);

        // Only verified collections can be traded: Chog, the partner and anything listed in TRADEABLE_COLLECTIONS.
        address[] memory verified = _verifiedList(c);
        if (verified.length != 0) sweeper.setVerifiedCollections(verified, true);
        if (c.finalOwner != c.deployer) sweeper.transferOwnership(c.finalOwner);

        vm.stopBroadcast();

        _report(c, address(sweeper), verified.length);
        chog = c.chog;
    }

    function _readConfig(address deployer) internal returns (Config memory c) {
        uint256 expectedChain = vm.envOr("EXPECTED_CHAIN_ID", MONAD_TESTNET);
        if (block.chainid != expectedChain) revert WrongChain(expectedChain, block.chainid);

        c.deployer = deployer;
        c.fee = vm.envOr("PLATFORM_FEE_WEI", uint256(0));
        if (c.fee > type(uint128).max) revert FeeTooHighForConfig();
        c.treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        c.finalOwner = vm.envOr("OWNER_ADDRESS", deployer);
        c.chog = vm.envOr("CHOG_COLLECTION", address(0));
        c.partner = vm.envOr("PARTNER_COLLECTION", address(0));
        c.deployMock = vm.envOr("DEPLOY_MOCK_CHOG", c.chog == address(0));

        // A faucet-style mint contract has no business anywhere but a test network.
        if (c.deployMock && block.chainid != MONAD_TESTNET && block.chainid != ANVIL) {
            revert MockNotAllowedHere(block.chainid);
        }
    }

    /// @dev Deploys MockChog and mints the optional seed tokens (SEED_MINT_TO / SEED_MINT_COUNT).
    function _deployMock() internal returns (address) {
        address[] memory seedTo = vm.envOr("SEED_MINT_TO", ",", new address[](0));
        uint256 seedCount = vm.envOr("SEED_MINT_COUNT", uint256(1));
        MockChog mock = new MockChog();
        for (uint256 i; i < seedTo.length; ++i) {
            if (seedCount > 0) mock.mintBatch(seedTo[i], seedCount);
        }
        return address(mock);
    }

    function _verifiedList(Config memory c) internal returns (address[] memory list) {
        address[] memory extra = vm.envOr("TRADEABLE_COLLECTIONS", ",", new address[](0));
        list = new address[](extra.length + 2);
        uint256 n;
        if (c.chog != address(0)) list[n++] = c.chog;
        if (c.partner != address(0)) list[n++] = c.partner;
        for (uint256 i; i < extra.length; ++i) {
            list[n++] = extra[i];
        }
        assembly ("memory-safe") {
            mstore(list, n)
        }
    }

    function _report(Config memory c, address sweeper, uint256 verifiedCount) internal view {
        console2.log("Deployer:        ", c.deployer);
        console2.log("Chain id:        ", block.chainid);
        console2.log("Treasury:        ", c.treasury);
        console2.log("Platform fee wei:", c.fee);
        console2.log("ChogSweeper:     ", sweeper);
        console2.log("Chog collection: ", c.chog);
        console2.log("Partner:         ", c.partner);
        console2.log("Verified count:  ", verifiedCount);
        console2.log("Mock Chog:       ", c.deployMock);
        if (c.finalOwner != c.deployer) console2.log("Ownership pending; must be accepted by:", c.finalOwner);
    }
}
