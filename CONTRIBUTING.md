# Contributing to Sentri

Thanks for your interest in Sentri. This document covers the development setup, the testing requirements that gate every PR, and the commit / PR conventions.

## Development setup

### Prerequisites

- Node ≥ 20, pnpm ≥ 9
- [Foundry](https://book.getfoundry.sh/) for the contracts
- A wallet with a small amount of native OG ([Galileo faucet](https://faucet.0g.ai)) if you need to test against a deployed factory

### Install

```bash
git clone https://github.com/RedGnad/Sentri.git
cd Sentri
pnpm install
```

### Run the dashboard

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm dev
# http://localhost:3000
```

### Run the agent

```bash
cp packages/sdk/.env.example packages/sdk/.env
pnpm --filter @steward/sdk run setup-broker
pnpm --filter @steward/sdk run server
```

### Run the contract test suite

```bash
cd contracts
forge test
```

## Testing requirements

Every PR must pass:

- `cd contracts && forge test` — all 86 tests green, no skipped suites.
- `pnpm --filter web lint` — ESLint clean on the dashboard.
- `pnpm --filter @steward/sdk run build` — TypeScript clean on the agent runtime.

PRs that change the contracts require corresponding tests. PRs that change the agent runtime should add or update tests where the existing structure permits and explain in the PR body why if not.

## Code style

### Solidity

- NatSpec on every public / external function.
- `forge fmt` before committing.
- New errors use the `error CamelCase()` pattern (no `require` strings).
- New events fire on every state-changing flow that an off-chain consumer would care about.
- Adhere to the checks-effects-interactions order; the existing Slither baseline must stay clean.

### TypeScript

- `tsc` strict; the agent and the SDK type-check end-to-end before merging.
- Prettier defaults via the workspace config.
- Server components by default in the Next.js app — `"use client"` only where it's actually needed.
- TanStack Query for server state, zustand for client state if reach is needed.

### Frontend

- Tailwind utility classes, no inline styles unless dynamic.
- Editorial Bloomberg-meets-academic-paper design language: terminal-grade information density, editorial typography (Instrument Serif, Inter Tight, JetBrains Mono).

## Commit and PR conventions

- [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Scope optional but encouraged: `feat(vault): …`.
- One concept per PR. Stack PRs if a refactor is large.
- PR description states: what changed, why, what tests now cover the change, what the rollback plan is for any contract change.
- No "coming soon" claims in code, registries, or UI without a working implementation behind them. The roadmap is a documentation section, not a feature claim.

## Reporting security issues

Please **do not** open a public GitHub issue for security findings. Email the maintainer with details and a reproduction. Coordinated disclosure is appreciated; we will credit the reporter in the post-fix changelog unless asked otherwise.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
