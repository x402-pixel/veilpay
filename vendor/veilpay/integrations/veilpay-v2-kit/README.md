# VeilPay v2 Integration Kit

**The only package an agent needs to build a full invoice site on VeilPay v2.**
Everything here is verified against live code and the live preprod contract.
No guessing. Follow the documents in order and you will not error.

| Doc | Purpose |
|---|---|
| [CONTRACT-CARD.md](CONTRACT-CARD.md) | The live contract: address, circuits, types, status codes |
| [INTEGRATION-API.md](INTEGRATION-API.md) | Copy-paste server routes: create invoice, pay, refund, cancel |
| [PUBLIC-READS.md](PUBLIC-READS.md) | Read invoice status publicly (checkout page, dashboard) |
| [WALLETS-LACE-1AM.md](WALLETS-LACE-1AM.md) | Lace + 1AM wallet: what works today, what is phase 2 |
| [INVOICE-LIFECYCLE.md](INVOICE-LIFECYCLE.md) | Full lifecycle, NullPay mapping, v1 -> v2 migration checklist |
| [NULLPAY-UI-PHASE1.md](NULLPAY-UI-PHASE1.md) | Exact NullPay phase-1 UI (every field, state, route) mapped onto our v2 invoice pages |

## Contract card (memorize this)

```text
network      Midnight Preprod
address      0x85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7
explorer     https://preprod.midnightexplorer.com/contracts/0x85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7
version      v2-shielded (real token transfers, NullPay parity)
source       contract/src/veilpay2.compact  (compactc 0.31.1)
metadata     deployments/preprod-v2.json
```

## The 60-second integration

1. Clone, install, place your seed + session (see INTEGRATION-API.md "Prerequisites").
2. Build the provider stack once per server process:
   `const { providers } = await buildGatewayStack(logger, { version: 'v2' })`
3. Join the live contract:
   `const api = await VeilPay2API.join(providers, ADDRESS, logger)`
4. Create an invoice:
   `const id = await api.createIntent(amount, expiresAt, tokenColor, merchantCoinPk, paymentSecret)`
5. Read status publicly for any visitor (no keys, no session needed on your page):
   `GET /api/invoice/[id]` per PUBLIC-READS.md.

## Hard rules (violating these is where other agents got stuck)

- **Writes go server-side. Reads are the only public path.** The browser never
  holds the merchant secret and never submits transactions in Phase 1.
- **`createIntent` registers the payment secret before it submits** (the API
  does this for you: `withPaymentSecret2(privateState, sequence + 1n, secret)`).
  Do not "pre-set" private state yourself or you will race the API.
- **`expiresAt` is a sequence bound, not a wall clock.** Contract asserts
  `sequence <= expiresAt`. Anchor it as `currentSequence + ttlOps`.
- **All amounts are `Uint<128>` and all ids are `Uint<64>`.** In JavaScript
  they are `bigint`. In JSON, serialize them as **decimal strings**. The
  single most common agent error is `JSON.stringify` on a bigint (throws) or
  `Number()` on one of them (silent precision loss).
- **`tokenColor` is exactly 32 bytes of hex.** All-zero bytes = open intent
  (accepts any shielded token). A real color pins the invoice to one token.
- **Never commit** `cli/.veilpay-state/` (seed, session token, addresses).
  It is gitignored for a reason.

## Verified working commands (run today)

```bash
# create a v2 intent on the live contract (merchant side)
npm --workspace cli run preprod-tx2 -- create 2500 50

# one-intent / full-ledger public status read
npm --workspace cli run preprod-tx2 -- status

# public status read, no keys/session (verified live 2026-09-13):
node scripts/verify-v2-public.mjs

# gateway-session status read (server fallback):
node scripts/verify-v2-live.mjs
```
