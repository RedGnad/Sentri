# V2 storage root forensics

Date: 2026-05-29

Scope: read-only inspection of recent 0G Storage roots for the V2 canary execution.
No contracts, execution code, runtime agent, or audit index writes were changed.

## Target

- V2 vault: `0x86cE22c597D0C4EC309ba166360686C39A3f40ed`
- Canonical tx: `0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa`

## Command

```sh
pnpm --filter @steward/sdk inspect:storage-roots -- \
  --network mainnet \
  --vault 0x86cE22c597D0C4EC309ba166360686C39A3f40ed \
  --tx 0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa \
  --roots 0x537c8a51055496bd2df34e6976ab5f11e849cd501ce689a05ae063057eb9f9ca,0x71a0a3723e089a2ebb44e5b76e78aae9cb02cacf5a96275663e49ad48f24a08d,0x06cf6c24ce1eeccb6091bef0b7d888d92f6765a3dd74337e2051e3df3334a060,0x23debac69cad09cf1c754428ef5fbe3e26ba4dc51e8933e9d984a92efeea60f8
```

## Result

- Inspected roots: `4`
- Downloaded JSON blobs: `4`
- Roots matching target vault: `0`
- Roots matching canonical tx: `0`
- Roots matching both: `0`
- Direct backfill candidates: `0`

All four inspected blobs were recoverable `sentri.audit.v1` records, but they
belonged to the Standard mainnet vault `0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E`.
None contained `sentri.inference.v1`, the V2 vault, or the canonical V2 tx hash.

## On-chain V2 proof

The canonical tx is a successful V2 trustless execution:

- block: `34653960`
- intentHash: `0x3afd046a1044b43b10783d2123415da0c5f193776c2affcacc582e8125ea790d`
- responseHash: `0xfff7ff286d0703c30666ba2c1d76214b79edd2c97d3f0c300217c638d120ffae`
- teeSigner: `0x0038F716958A90b753DA6937787395E2365DB2e8`
- AgentINFT: `0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951`
- pythPriceId: `0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070`
- pythPublishTime: `1780029724`
- pythConfBps: `22`

## Conclusion

Among the inspected recent roots, there is no honest audit-index backfill source
for the V2 canary reasoning. The V2 canary has on-chain execution proof and
hashes, but this execution does not currently have a recovered durable reasoning
record.

Next branch: `feat/v2-audit-parity-tee-receipt`, focused on an additive V2
TeeReceipt flow for future V2 executions, without changing contracts or the
standard runtime path.
