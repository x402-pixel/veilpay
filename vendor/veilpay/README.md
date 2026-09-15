# VeilPay

Privacy-preserving payment intents on Midnight Preprod. A merchant publishes a
checkout request on-chain; a customer settles it by proving knowledge of a
payment secret inside a ZK circuit. The public ledger records **that** a
payment is verified and its amount -- never who paid.

## Live Deployment (v2 -- integrate against this one)

| Field | Value |
|---|---|
| Network | Midnight Preprod |
| Contract | `0x85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7` |
| Version | v2-shielded: private invoices WITH real shielded token transfers (NullPay parity) |
| Deploy tx | `0x80bc77767f62fe711c8f1095a261f5a5296de665d2523850ab9afdf8e5982ad2` |
| Block | 2,521,381 (Sep 12, 2026, 19:22 UTC) |
| Explorer | [preprod.midnightexplorer.com](https://preprod.midnightexplorer.com/contracts/0x85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7) |
| Metadata | [deployments/preprod-v2.json](deployments/preprod-v2.json) (circuits, verifier-key hashes, endpoints) |

Intent #1 (amount 2500, ACTIVE) is live on this contract, created via
`npm --workspace cli run preprod-tx2 -- create 2500 50`. The v1 oracle
(`0x304666ce...1d719f`, verify-only, moves no tokens) remains deployed for
read-compat; new work targets v2.

## Repo Layout

```
contract/   veilpay.compact + compiled managed artifacts + 10 vitest tests
api/        VeilPayAPI: deploy/join contract, createIntent/pay/refund/cancel
cli/        faucet-path CLI + sponsored-gateway deploy & lifecycle drivers
scripts/    verify-live.mjs (read-only live ledger check)
 docs/       V1-VS-V2.md (start here), WEBSITE-INTEGRATION.md, DEPLOYMENT.md
integrations/veilpay-v2-kit/  **agent integration kit** for v2 (read this first)
```

## Quickstart

```bash
npm install
npm --workspace contract run test          # 10 tests, simulated ledger

# read the live contract (needs a cached gateway session in cli/.veilpay-state)
node --experimental-specifier-resolution=node scripts/verify-live.mjs

# lifecycle against the deployed contract
npm --workspace cli run preprod-tx -- status
npm --workspace cli run preprod-tx -- create <amount> [ttlOps]
npm --workspace cli run preprod-tx -- pay <id> <secretHex>
```

## Docs

- [integrations/veilpay-v2-kit/README.md](integrations/veilpay-v2-kit/README.md) --
  the v2 integration kit: verified contract card, copy-paste server routes
  (create invoice / pay / status), public-read path (official v3 indexer,
  verified live), Lace + 1AM wallet matrix, invoice lifecycle, and the
  v1 -> v2 migration checklist. Built so an agent can ship a full site on v2
  without rediscovering any of this.
- [docs/V1-VS-V2.md](docs/V1-VS-V2.md) -- what v1 and v2 each are, why v2
  exists (NullPay parity: real shielded token transfers), and which one to
  integrate against.
- [docs/MIGRATION-V2-INVOICE.md](docs/MIGRATION-V2-INVOICE.md) -- exact
  schema/vocabulary delta for moving the web app from v1 intents to v2
  invoices, with re-verified live-contract ground truth.
- [docs/WEBSITE-INTEGRATION.md](docs/WEBSITE-INTEGRATION.md) -- build a website
  on the deployed contract: architecture, provider singleton, API-route
  recipes, lifecycle semantics, gotchas.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) -- how this contract got to preprod
  through the sponsored gateway, every tool used, and how the deploy compares
  with zarkbns/condition.

## License

Apache-2.0
