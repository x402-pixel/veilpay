# Migration Plan: v1 -> v2, Intents -> Invoices

Audience: the web-app agent. The site at veilpay-sigma.vercel.app is powered by
v1 (or mock data shaped like v1). This is the exact delta for moving it to the
v2 shielded-token contract and the invoice vocabulary.

## Live contract ground truth (re-verified 2026-09-13)

| | v1 (current site target) | v2 (migration target) |
|---|---|---|
| Address | `0x61ecd947...38bcd2` (control deploy; earlier ones at `304666ce...`, `9747c13e...`) | `0x85a0f911...583a7` (block 2521381) |
| On-chain state | sequence 0 (this instance has no intents) | sequence 1: intent #1 ACTIVE amount=2500 color=open merchantPk=0ed55a43... receipt=false |
| Reads | `scripts/verify-live.mjs` | `scripts/verify-v2-live.mjs` |

Read both ledgers directly via `queryContractState` + the committed compiled
decoder in `contract/src/managed/<name>/contract/index.js` (`ledger(state.data)`).
Do NOT rely on the indexer `contractAction(address)` lookup: on the gateway
indexer it intermittently returns null for recent contracts. Hash-based tx
queries and direct state reads are reliable.

## Network endpoints (runtime vs deploy-time)

The live web app does NOT need the 1AM gateway (`api-preprod.1am.xyz`). That
endpoint is our DEPLOY-TIME workaround only (sponsored DUST, hosted proving,
authenticated indexer session). App runtime uses public Midnight endpoints:

- Indexer reads: `https://indexer.preprod.midnight.network/api/v3/graphql`
  (unauthenticated; same surface condition's live `/verify` + `/explorer` use)
- Tx submission / state: `wss://rpc.preprod.midnight.network` (public RPC;
  users sign via the Lace/1AM browser EXTENSION and pay fees from their own
  DUST -- the app never sponsors anyone)
- Proving: client-side from the committed `.zkir`/verifier keys under
  `contract/src/managed/veilpay2/` (serve statically; no proof server needed)

Rules: never ship or reuse `cli/.veilpay-state/gw_session.json` in the site
(personal, expiring deploy session -- a leak and a point of failure), and on
first integration confirm the official v3 indexer decodes the v2 ledger shape
identically to the v4 gateway reads (one-line schema fix if it drifts).

## Hard schema breaks (v1 -> v2)

1. `createIntent` gained two arguments:
   `createIntent(amount, expiresAt)` ->
   `createIntent(amount, expiresAt, tokenColor, merchantCoinPk)`
   - `merchantCoinPk`: 32-byte hex, REQUIRED and nonzero. This is the merchant's
     zswap **coin** public key (where funds land). It is NOT a Lace/Midnight
     wallet address (`mn_addr...`). Your merchant onboarding must collect it.
   - `tokenColor`: 32-byte hex or all-zeros. Zeros = open invoice (any shielded
     token accepted). Pin a color per accepted token once chosen.
2. `pay(intentId)` -> `pay(intentId, coin)` where `coin` is a full
   `QualifiedShieldedCoinInfo { nonce, color, value, mt_index }` from the
   payer's synced shielded wallet. The customer step is no longer a secret-only
   proof; it spends a real coin and returns change to the payer.
3. `Intent` struct gained `merchantCoinPk` and `tokenColor` fields.
4. New public ledger `receipts: Map<Uint<64>, Bytes<32>>`. After a pay, the
   receipt commitment `H("veilpay:receipt:" || id || amount || receiptSecret)`
   is publicly readable; the payer's `receiptSecret` never leaves their wallet.
5. Ids are plain `Uint<64>` counters (`1, 2, 3...`), not payment-intent style
   hashes. There is NO on-chain `pi_xxx` anything.
6. v2 has no native token and NEVER touches tDUST: amounts are in whichever
   shielded zswap token color the invoice pins (or any, when open).

## What is NOT on-chain (and must not be faked on the explorer)

The public ledger contains only the Intent struct + sequence + receipts.
These UI fields from the current mock feed have no on-chain source:

- merchant display names ("VeilPay Test Shop", "Test Merchant Co")
- order references ("E2E-TEST-001", "Invoice #2026-Audit-01")
- `pi_...` payment ids (replace with the numeric invoice id)
- recipient `mn_addr...` addresses (v2 recipient is a masked coin pk:
  show first 6 of `merchantCoinPk`)
- "tDUST" units (show amount + token color short-name only)

Migration options: (a) render strictly what is on-chain, or (b) keep an
off-chain side table (Supabase or the api workspace) mapping
`invoiceId -> {merchantName, orderRef, description}` populated at create time,
joined into the explorer feed. (b) preserves the current design; label such
joined fields clearly as merchant-provided metadata, never as chain data.
"SETTLED VOLUME 0.01" must be dropped or recomputed from real PAID amounts.

## Status mapping

| v2 IntentStatus | UI label |
|---|---|
| ACTIVE | Open (Awaiting Payment), or Expired when `sequence > expiresAt` |
| PAID | Verified / Paid (receipt exists in `receipts`) |
| REFUNDED | Refunded (merchant paid out-of-band) |
| CANCELLED | Cancelled |

`expiresAt` is in ledger-operations (sequence) units, not wall-clock seconds.
A feed cannot derive "2h ago" from the contract; timestamps must come from the
deploy indexer tx times or the off-chain table.

## Vocabulary: intent -> invoice (app layer only)

No circuit or address changes for the rename. Mapping:

| contract name | product name |
|---|---|
| payment intent | invoice |
| `createIntent` | issue invoice |
| `paymentSecret` | claim code (inside the pay link) |
| checkout link | `pay/<id>?secret=<hex>` (secret stays client-side) |
| `receipts[id]` | payment receipt |
| `isPaid(id)` | invoice settled? |

Update docs/WEBSITE-INTEGRATION.md, V1-VS-V2.md and UI copy together so agents
see one vocabulary. Keep contract names in parentheses once for traceability.

## Payer funding caveat (blocks the pay demo, not the migration)

A value-moving pay needs one funded, synced shielded coin of the right color on
preprod. Everything else migrates fine without it: issue, isPaid, refund/cancel
bookkeeping, explorer reads, invoice links/QR, receipt commitment display.
Until funding lands, demo `pay` against the simulator path, not live.

## Concrete steps

1. Point the data layer at `0x85a0f911...583a7`; decode with
   `managed/veilpay2/contract` `ledger()` (mirror `scripts/verify-v2-live.mjs`).
2. Switch create/pay/refund/cancel routes to the v2 wrapper (`api/src/index2.ts`
   `VeilPay2Contract`) so signatures line up.
3. Add merchant `merchantCoinPk` collection + optional `tokenColor` to invoice
   creation UI; default open (zeros).
4. Replace `pi_` ids with numeric invoice ids; add the off-chain metadata join
   if the design needs names/refs.
5. Kill all tDUST formatting; show amount + color (or "any token").
6. Rename UI copy to invoice vocabulary.
7. Re-verify: create a live invoice through the site, confirm it appears in
   `verify-v2-live.mjs` output with the next sequence number, then flip the
   explorer from mock to chain feed.
