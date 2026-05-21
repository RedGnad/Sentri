# Operator runbook — `InvalidTEESignature` / TEE signer mismatch

## Symptom

The agent runner logs one of:

```
SKIPPED_TEE_SIGNER_MISMATCH
Execution blocked: recovered TEE signer is not bound to the active AgentINFT.
Funds are safe. Operator action required.
```

or, if a transaction was already sent before this hotfix:

```
ERROR: execution reverted (unknown custom error)  data="0x4c0f9589"
```

`0x4c0f9589` is the 4-byte selector of `InvalidTEESignature()` —
`keccak256("InvalidTEESignature()")[:4]`, verifiable with
`ethers.id("InvalidTEESignature()").slice(0, 10)`.

## What it means

`TreasuryVault.executeStrategy` calls `_verifyTEE`, which recovers the TEE
signer from the signed 0G inference response and then requires:

```solidity
if (!agentNFT.isActiveAgentWithSigner(msg.sender, teeSigner))
    revert InvalidTEESignature();
```

The revert means the **TEE signer recovered from the 0G Sealed Inference
response is not the `teeSignerAddress` recorded in the agent's active
AgentINFT**. Common causes:

- the 0G provider rotated its TEE signer after the AgentINFT was minted;
- the runner selected a different 0G provider than the one the AgentINFT was
  minted for (`selectProvider()` picks the most-recently-updated acknowledged
  verifiable chatbot provider — that can change over time);
- the AgentINFT was minted with the wrong `teeSignerAddress`.

## Why funds are safe

`InvalidTEESignature` reverts **before** any swap or transfer. With this hotfix
the runner also runs the same check **read-only before sending anything**
(`preflightTeeSigner`), so on a mismatch:

- no `estimateGas` call is made;
- no `executeStrategy` transaction is sent;
- the cycle is skipped and logged as `SKIPPED_TEE_SIGNER_MISMATCH`;
- vault balances, policy, and the kill-switch are untouched.

Deposits, withdrawals, `pause`/`unpause`, and `emergencyWithdraw` are unaffected
— only autonomous strategy execution is paused until the binding is reconciled.

## How the runner behaves now

- **Provider pinning.** At startup the runner reads the expected TEE signer from
  the AgentINFT and pins the 0G provider whose signer matches it — instead of
  picking whichever provider is newest. (0G's provider registry changes over
  time; a recency-based pick silently breaks the on-chain binding.) An explicit
  `SENTRI_EXPECTED_TEE_SIGNER` env var overrides the on-chain value if needed.
- **Hard signer-health gate.** Every cycle the runner re-checks
  `isActiveAgentWithSigner(agent, providerSigner)`. While it is `false` the whole
  cycle is skipped — no price push, no inference, no `executeStrategy` — and the
  runner logs `BLOCKED_SIGNER_HEALTH`. `GET /healthz` reports
  `autoExecute: false` and a `signerHealth` block.
- **Self-heal.** The gate is re-evaluated each cycle, so once the binding is
  reconciled **on-chain** the runner resumes automatically on the next cycle —
  no restart. If instead you change the runner's provider configuration (env),
  restart the runner so it re-selects the provider.

## Step 1 — Diagnose

Run the read-only diagnostic (no private key needed):

```bash
# expected signer on-chain only
pnpm --filter @steward/sdk check-signer

# confirm a specific recovered signer matches
RECOVERED_TEE_SIGNER=0x<signer-from-the-latest-TEE-response> \
  pnpm --filter @steward/sdk check-signer
```

It prints the agent address, AgentINFT address + token id, the on-chain
`expectedSigner`, the provider string, the metadata root hash, the recovered
signer, and a verdict.

### Reading the on-chain signer manually

The expected signer lives in the AgentINFT metadata. Read it via the
`agentMetadata` public mapping getter:

```bash
# agentMetadata(tokenId) returns:
#   (bytes32 enclaveHash, bytes32 attestationHash, string provider,
#    address teeSignerAddress, uint256 issuedAt, bool revoked,
#    bytes32 metadataRootHash)
cast call <AGENT_INFT_ADDRESS> \
  "agentMetadata(uint256)(bytes32,bytes32,string,address,uint256,bool,bytes32)" \
  <AGENT_TOKEN_ID> \
  --rpc-url https://evmrpc-testnet.0g.ai
```

> The v2-only `intelligentDataOf(tokenId)` convenience view is **not** present
> on every deployment (it reverts on the pre-v2 Galileo AgentINFT
> `0x1181A8670d5CA9597D60fEf2A571a14C58F33020`). Always use `agentMetadata`,
> which exists on every version. The `check-signer` CLI already does this.

Then confirm the binding the vault actually checks:

```bash
cast call <AGENT_INFT_ADDRESS> \
  "isActiveAgentWithSigner(address,address)(bool)" \
  <AGENT_ADDRESS> <RECOVERED_TEE_SIGNER> \
  --rpc-url https://evmrpc-testnet.0g.ai
```

`false` here is exactly what makes `executeStrategy` revert.

## Step 2 — Decide

**A. The recovered signer is wrong** — the runner selected a 0G provider whose
TEE signer is not the one the AgentINFT was minted for. This is the most common
case and the **preferred fix**: reconcile the runner so it uses the provider
whose TEE signer equals the on-chain `teeSignerAddress`. Do **not** touch any
contract. Nothing on-chain needs to change.

**B. The recovered signer is the correct, current provider signer** and the
AgentINFT records a stale one — then the on-chain binding has to change. See
Step 3; the available path depends on the deployed AgentINFT version.

## Step 3 — Change the on-chain binding (owner only, Case B)

> ⚠️ Whether this is even possible depends on the **deployed** AgentINFT, not on
> the contract source in this repo. Verify first.

### If the AgentINFT exposes `rotateSigner` (v2 deployments)

`AgentINFT.rotateSigner` is `onlyOwner` by design: a compromised agent wallet
must never be able to swap the TEE signer that constrains it. Only the
AgentINFT contract **owner** may call it.

```bash
cast send <AGENT_INFT_ADDRESS> \
  "rotateSigner(uint256,address)" <AGENT_TOKEN_ID> <RECOVERED_TEE_SIGNER> \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --private-key <AGENT_INFT_OWNER_KEY>
```

### If the AgentINFT does NOT expose `rotateSigner`

The pre-v2 Galileo deployment `0x1181A8670d5CA9597D60fEf2A571a14C58F33020`
**does not have `rotateSigner`** (verified on-chain — calling its selector
reverts with empty data, unlike `revoke`/`reinstate` which exist). On such a
deployment the recorded signer is effectively immutable, so the realistic
options are:

1. **Reconcile the runner to the on-chain signer (recommended).** Pin the
   runner to the 0G provider whose TEE signer equals the on-chain
   `teeSignerAddress`. This needs no on-chain transaction at all.
2. **Mint a fresh AgentINFT bound to the new signer.** The deployed contract
   keeps `mint` (`onlyOwner`). `isActiveAgentWithSigner` scans *every* token the
   agent address holds, so minting a new token to the same agent wallet bound
   to the current provider signer makes the gate pass. This is a privileged
   identity change — perform it deliberately, with the owner key, and only
   after confirming the new signer is genuinely the correct provider signer.

Confirm the AgentINFT owner before either action:

```bash
cast call <AGENT_INFT_ADDRESS> "owner()(address)" \
  --rpc-url https://evmrpc-testnet.0g.ai
```

After any change, re-run `check-signer` — the verdict should read `OK`. An
**on-chain** reconciliation (rotate/mint) is picked up automatically: the
runner's per-cycle signer-health gate self-heals on the next cycle, no restart.
If you instead reconciled by changing the **runner's** provider configuration
(env vars), restart the runner so it re-selects the provider.

> ⚠️ **Never automate signer rotation or minting inside the runner.** These are
> privileged identity changes and are intentionally manual, owner-keyed
> operations. The runner only ever performs the read-only preflight; it must
> not hold or use the AgentINFT owner key.

## Reference

- `contracts/src/TreasuryVault.sol` — `_verifyTEE`, `InvalidTEESignature`
- `contracts/src/AgentINFT.sol` — `agentMetadata`, `isActiveAgentWithSigner`,
  `rotateSigner` (present in the v2 source; absent on the pre-v2 Galileo
  deployment)
- `packages/sdk/src/agent-signer.ts` — `preflightTeeSigner`, `fetchSignerHealth`
- `packages/sdk/src/vault-errors.ts` — custom-error selector decoder
- `packages/sdk/src/check-agent-signer.ts` — the `check-signer` CLI
