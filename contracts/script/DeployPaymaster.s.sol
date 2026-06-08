// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VerifyingPaymaster} from "@account-abstraction/contracts/samples/VerifyingPaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/// @notice Deploys the audited eth-infinitism VerifyingPaymaster (unmodified)
///         that sponsors gas for Sentri's Safe-based smart wallets on 0G.
///
///         The paymaster trusts an off-chain `verifyingSigner` (held by the
///         Sentri paymaster signer service) to decide which UserOps to sponsor.
///         EntryPoint v0.7 is already deployed on 0G at the canonical address.
///
///         Env:
///           PRIVATE_KEY                  deployer (becomes paymaster owner)
///           PAYMASTER_VERIFYING_SIGNER   address of the signer service key
///           ENTRYPOINT                   optional; defaults to canonical v0.7
///           PAYMASTER_DEPOSIT_WEI        optional; OG deposited to EntryPoint
///                                        so the paymaster can pay gas (0 = skip)
///           PAYMASTER_STAKE_WEI          optional; OG staked for reputation
///                                        (0 = skip)
///           PAYMASTER_UNSTAKE_DELAY      optional; stake unbond seconds (def 1d)
///
///         Run (mainnet):
///           forge script script/DeployPaymaster.s.sol \
///             --rpc-url og_mainnet --broadcast
contract DeployPaymaster is Script {
    // Canonical ERC-4337 EntryPoint v0.7 — verified deployed on 0G mainnet+testnet.
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address verifyingSigner = vm.envAddress("PAYMASTER_VERIFYING_SIGNER");
        address entryPoint = vm.envOr("ENTRYPOINT", ENTRYPOINT_V07);
        uint256 depositWei = vm.envOr("PAYMASTER_DEPOSIT_WEI", uint256(0));
        uint256 stakeWei = vm.envOr("PAYMASTER_STAKE_WEI", uint256(0));
        uint256 unstakeDelay = vm.envOr("PAYMASTER_UNSTAKE_DELAY", uint256(86400));

        require(verifyingSigner != address(0), "PAYMASTER_VERIFYING_SIGNER unset");

        vm.startBroadcast(deployerKey);

        VerifyingPaymaster paymaster = new VerifyingPaymaster(IEntryPoint(entryPoint), verifyingSigner);
        console2.log("VerifyingPaymaster:", address(paymaster));
        console2.log("  entryPoint:      ", entryPoint);
        console2.log("  verifyingSigner: ", verifyingSigner);
        console2.log("  owner:           ", vm.addr(deployerKey));

        // Deposit funds the paymaster's gas balance held inside the EntryPoint.
        // Stake builds reputation so bundlers accept its UserOps (required once
        // the paymaster sponsors ops that deploy a new account via initCode).
        if (depositWei > 0) {
            paymaster.deposit{value: depositWei}();
            console2.log("  deposited (wei): ", depositWei);
        }
        if (stakeWei > 0) {
            paymaster.addStake{value: stakeWei}(uint32(unstakeDelay));
            console2.log("  staked (wei):    ", stakeWei);
            console2.log("  unstakeDelay(s): ", unstakeDelay);
        }

        vm.stopBroadcast();
    }
}
