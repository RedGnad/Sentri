# ExecutionRegistry — verifiable execution receipts for 0G agents

A permissionless, shared on-chain registry where **any** agent can leave a
tamper-evident, replay-protected, rate-limited receipt for an off-chain decision
it executed. It is the reusable kernel of Sentri's on-chain guardrail — the
verifiable-execution + audit-log pattern — generalised so other builders can plug
in. It deliberately does **not** include Sentri's portfolio risk policy
(allocation / drawdown), which is vault-specific and stays in the vault.

> Status: primitive, open for integration. The Sentri vault is the reference
> design; `ExampleRegistryConsumer` is a minimal reference integration. No
> third-party adoption is claimed.

## Why

Most agents execute decisions off-chain and leave no verifiable trail. The
registry gives any agent a one-call way to publish a receipt that anyone can read
back and re-verify: *this signer authorised this intent, exactly once, no faster
than this cooldown, here is the attestation reference.* It matches 0G's thesis —
infrastructure agents can trust, not rent.

## Integrate in two steps

### 1. Register (once)

Pick **one** authoriser:

- a fixed `signer` address (simplest), or
- a `verifier` contract implementing `ISignerVerifier` (e.g.
  `AgentINFTSignerVerifier`, which authorises against a live AgentINFT TEE signer).

```solidity
// fixed signer, no cooldown
registry.register(mySigner, address(0), 0);

// or: AgentINFT-backed, 60s cooldown
registry.register(address(0), agentInftVerifier, 60);
```

### 2. Record each execution

```solidity
// after your agent performs its on-chain action:
uint256 index = registry.recordExecution(
    intentHash,      // bytes32, single-use id of this intent
    signedResponse,  // string, the decision payload that was signed
    signature,       // bytes, EIP-191 signature over signedResponse
    attestation,     // bytes32, off-chain attestation reference (e.g. TEE quote hash)
    payload          // bytes, opaque; only its keccak256 is stored
);
```

The registry verifies the signature, rejects a re-used `intentHash` or
`signedResponse`, enforces the cooldown, stores the receipt and emits
`ExecutionRecorded`.

## Signature scheme

Same EIP-191 scheme Sentri's vault uses:

```
responseHash = keccak256(bytes(signedResponse))
digest       = toEthSignedMessageHash(bytes(signedResponse))
signer       = ecrecover(digest, signature)
```

## Read receipts back

```solidity
reg.receiptCount(consumer);              // how many receipts
reg.receiptAt(consumer, i);              // one receipt
reg.receipts(consumer, start, limit);    // a page, in recorded order
reg.totalReceipts();                     // across all consumers
```

Each `Receipt` holds `{ timestamp, signer, intentHash, responseHash,
attestation, payloadHash }`. The `ExecutionRecorded` event also emits the
original `signedResponse` and `signature`, so any receipt is independently
re-verifiable **from logs alone**: recompute `keccak256(signedResponse)`, recover
the signer, and compare to the stored receipt. Storage keeps only hashes.

## Guarantees

- **Authorisation** — every receipt is signed by an authorised signer (fixed or
  via verifier).
- **No replay** — `intentHash` and `responseHash` are single-use, scoped per
  consumer.
- **Rate limit** — optional per-consumer cooldown between receipts.
- **Auditability** — receipts are append-only and world-readable; the
  `signedResponse` + `signature` are emitted in logs for log-only re-verification.

## Security notes

- **The signed response is not bound to the consumer, chain, or registry.** The
  signer authorises the *content*; the registry attributes the receipt to
  `msg.sender`. If your model needs a response usable by only one consumer / one
  chain / one deployment, include those (and a nonce) **inside** `signedResponse`.
- **Single-use is per-consumer.** `intentHash` / `responseHash` are de-duplicated
  within a consumer only; a different consumer (or a second registry deployment)
  can record the same response.
- **The verifier is called via `STATICCALL`** (it is `view`), so it cannot
  reenter or mutate state. A misconfigured verifier only blocks the consumer that
  set it.

## Price-attested receipts (the differentiated composition)

`PriceAttestedConsumer` composes the registry with Sentri's hardened Pyth adapter
(`PythPriceAdapter`): it pulls a fresh Pyth price, verifies it on-chain in the
same transaction (freshness + bounded confidence), then records a receipt whose
`payloadHash` commits to `abi.encode(price, publishTime, confBps)` and whose
`attestation` is the Pyth feed id. The result is a tamper-evident proof that the
agent executed **against a fresh, verified, bounded-confidence price** — not a
stale or trusted feed. Pyth alone is a commodity and the registry alone is a log;
the *composition* is the differentiator for verifiable finance.

```solidity
(uint256 index, uint256 price) = consumer.executeWithVerifiedPrice{value: fee}(
    intentHash, signedResponse, signature, pythUpdateData // Hermes VAAs
);
// later: keccak256(abi.encode(price, publishTime, confBps)) == receipt.payloadHash
```

## TypeScript client

A dependency-light (ethers-only) client ships in the SDK for builders who prefer
not to call the ABI directly. It is read + verify + build-calldata only — it
never holds a key or sends a transaction.

```ts
import {
  ExecutionRegistryReader,
  verifyReceipt,
  buildRecordExecutionCalldata,
} from "@steward/sdk/execution-registry";

const reader = new ExecutionRegistryReader(REGISTRY_ADDRESS, provider);
const receipts = await reader.receipts(consumer, 0, 50);

// re-verify a receipt off-chain against the original signed response
const { responseMatches, signerMatches } = verifyReceipt(receipts[0], signedResponse, signature);

// build calldata for your own signer to send
const data = buildRecordExecutionCalldata({ intentHash, signedResponse, signature, attestation, payload });
```

> MCP: wrapping these read/verify/calldata helpers as an MCP server (so agent
> clients discover the registry automatically) is a thin layer to add once
> `@modelcontextprotocol/sdk` can be installed. The functions above are the
> server's tool surface.

## Deployment

Deploy via `script/DeployExecutionRegistry.s.sol` (deployer key only — no
ownership over any existing Sentri contract; the live vault is untouched):

```bash
# simulate
forge script script/DeployExecutionRegistry.s.sol --rpc-url og_mainnet
# broadcast (optionally set AGENT_NFT_ADDRESS to also deploy the verifier)
forge script script/DeployExecutionRegistry.s.sol --rpc-url og_mainnet --broadcast
```

| Network | ExecutionRegistry | AgentINFTSignerVerifier |
| --- | --- | --- |
| 0G mainnet (16661) | _to be filled after broadcast_ | _optional_ |

## Files

- `contracts/src/ExecutionRegistry.sol` — the registry + `ISignerVerifier`
- `contracts/src/AgentINFTSignerVerifier.sol` — AgentINFT-backed verifier
- `contracts/src/examples/ExampleRegistryConsumer.sol` — minimal reference integration
- `contracts/src/examples/PriceAttestedConsumer.sol` — price-attested composition
- `contracts/test/ExecutionRegistry.t.sol` — 20 tests
- `contracts/test/PriceAttestedConsumer.t.sol` — 6 tests
- `contracts/script/DeployExecutionRegistry.s.sol` — registry deploy script
- `contracts/script/DeployPriceAttestedConsumer.s.sol` — price-attested example deploy
- `packages/sdk/src/execution-registry.ts` — TypeScript read/verify/calldata client
