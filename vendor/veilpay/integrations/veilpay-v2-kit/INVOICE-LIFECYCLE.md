# VeilPay v2 Invoice Lifecycle (and the NullPay map)

## The lifecycle, start to finish

```text
1. MERCHANT  generate paymentSecret = 32 random bytes               (off-chain)
2. MERCHANT  createIntent(amount, expiresAt, tokenColor, merchantCoinPk)
             -> circuit registers commitment = H("veilpay:intent:", id, secret)
             -> ledger: intents[id] = ACTIVE, sequence bumps        (ON-CHAIN)
3. MERCHANT  hand id + secret to the customer out-of-band
             (checkout URL /pay/<id>?s=<secret>, QR, chat). Only the
             COMMITMENT is on-chain; the secret never is.
4. CUSTOMER  opens /pay/<id> -> site reads public state (no keys)
             status=ACTIVE, amount, tokenColor, expiry vs sequence
5. CUSTOMER  pay(id, secret, coin):
             circuit checks secret -> matches commitment
             consumes the payer's shielded coin, sends amount to
             merchantCoinPk, change back to payer, stores receipt,
             marks PAID. Payer identity never touches public state.   (ON-CHAIN)
6. ANYONE    GET status -> PAID (+ hasReceipt)                      (public read)
7a. MERCHANT refund(id, refundAmount) on a PAID intent              (ON-CHAIN)
7b. MERCHANT cancel(id) on an unpaid intent                         (ON-CHAIN)
```

Expiry: `expiresAt` is checked against `sequence` at pay time. The contract
has no clock; every create/pay/refund/cancel advances it. Set
`expiresAt = currentSequence + ttlOps` (CLI uses ttlOps like 50–1000). UIs
should show "time remaining ≈ (expiresAt - sequence) operations", not fake
countdowns to a timestamp.

## The two secrets, precisely

| | merchantSecretKey | paymentSecret |
|---|---|---|
| Where | server private-state store (persist! per merchant) | generated per invoice, shared to payer |
| Public trace | `merchantId = H(merchantSecretKey)` (32 bytes) | `secretCommitment = H("veilpay:intent:", id, secret)` |
| Used by | createIntent, refund, cancel | pay |
| Lost means | can never refund/cancel old invoices | that one invoice can never be paid |

`receiptSecret` is a third, payer-side long-lived private-state key: it
tweaks the receipt recorded per payment so receipts are unlinkable across
invoices.

## Mapping to NullPay (what "same thing, on Midnight" means)

| NullPay (Aleo) | VeilPay v2 (Midnight) |
|---|---|
| `BHP256` invoice commitment stored in mapping | `secretCommitment = H(id, paymentSecret)` in `Intent` |
| `transfer_private` moves the token | `pay` circuit consumes shielded coin, sends to `merchantCoinPk`, change back (zswap) |
| Private transfer + invoice payment receipts | `receipts: Map<id, Bytes<32>>` receipt entry + payer-side `receiptSecret` |
| Oracle-converted fiat amounts | fiat quoted off-chain; on-chain `amount` is token units of `tokenColor` (open-intent = any color) |
| `pay_invoice` program | `api.pay(intentId, paymentSecret, coin)` |
| Ciphertext invoice record + AES-256-GCM | URL-carried `paymentSecret` (the ciphertext analogue); commitment binds it to the id |

What NullPay has that v2 Phase 1 does not yet:
**browser-wallet settlement** (Lace/1AM pay button) and an **invoice
expiration refund** enforced by block height. Both are Phase 2 line items;
the contract-side refund/cancel authority already exists.

## Invoice URL convention (matches NullPay UX)

```text
/pay/<intentId>?s=<paymentSecretHex64>
```

The site shows amount + status; the secret is only ever sent to **your**
server (POST /pay), never to the indexer or explorer. Store
`{ intentId -> { paymentSecret, orderRef } }` in your DB at create time.

## v1 -> v2 migration checklist (the veilpay-sigma.app move)

1. Address: `0x304666ce...` (v1 oracle) -> `0x85a0f911...` (v2 shielded).
   Env var `VEILPAY_CONTRACT_ADDRESS_V2`.
2. Swap imports: `VeilPayAPI` (`api/src/index.ts`) -> `VeilPay2API`
   (`api/src/index2.ts`); provider type `VeilPay2Providers`; stack call adds
   `{ version: 'v2', privateStateStoreName: 'veilpay2-private-state' }`.
3. `createIntent` gains two arguments: `tokenColor` (pass `new Uint8Array(32)`
   for open invoices) and `merchantCoinPk` (your coin key — see
   INTEGRATION-API). v1's `createIntent(amount, expiresAt)` is gone; v1 ids
   are **not** valid on v2 — fresh ledger, sequence restarts at 0.
4. Status JSON: keep the v1 field names (`id/status/amount`), add the v2
   fields from PUBLIC-READS.md — the frontend keeps rendering unchanged and
   gains `paidAmount/hasReceipt/tokenColor` for the receipt UI.
5. Merchant identity: v1 and v2 stores use different private-state stores;
   migrating does NOT carry `merchantId` across. Old v1 intents remain
   verifiable on the v1 address (keep a dual-read banner in the dashboard for
   one release).
6. Landing copy: "verify-only oracle" -> "private settlement": customers pay
   from shielded balances; merchants receive tokens directly to
   `merchantCoinPk`; nobody learns payer->invoice links from public state.

## What "done" looks like for the hackathon demo

- Merchant dashboard creates an invoice -> invoice id + secret minted on-chain
  in ~30s (the gateway create is proven: intent #1 exists on the live
  contract).
- Customer link shows the invoice from **public reads** on any machine, no
  wallet.
- Pay: server-driven settle via `preprod-tx2 pay` (or Lace once Phase 2),
  status flips to PAID with receipt, explorer shows the call tx.
- Refund/cancel visible in dashboard. All of the above against
  `0x85a0f911...1d719f`-style real addresses on Midnight Preprod.
