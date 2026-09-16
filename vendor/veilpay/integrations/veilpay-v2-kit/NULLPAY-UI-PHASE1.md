# NullPay Phase-1 UI (exact) -> VeilPay v2 migration map

Extracted verbatim from `github.com/geekofdhruv/NullPay` @ `c1fb163`, cloned at
`work/nullpay/frontend/src`. This is the phase-1 surface set we are mirroring:
**create invoice, share card, hosted checkout, pay page, invoice details**.
Every field name, state, and route below is real code, not invented.

## 0. App shell

- Vite SPA, `react-router-dom` (`BrowserRouter`). No SSR.
- `App.tsx` splits at 768px: `useIsMobile()` renders lazy `MobileApp` or
  `DesktopApp`. Same routes in both trees; separate page components.
- Shared building blocks: `GlassCard` (blur/border card), `Button`,
  framer-motion `pageVariants` for enter/exit, `react-hot-toast` bottom-center,
  dark bg `rgba(10,10,10,.92)` toasts with orange (#f97316) accent ring.
- Accent system: neon cyan `#00f3ff` primary, orange CTAs, type colors:
  Standard = white, Multi-Pay = purple `#d8b4fe`, Donation = pink `#f9a8d4`.

## 1. Routes (their file -> our VeilPay route)

```text
NullPay                          VeilPay v2 target
/create          (protected)  ->  /app/invoices/new
/checkout/:id                 ->  /pay/[intentId]        (customer checkout)
/pay  (?hash&salt query)      ->  folded into /pay/[intentId]
/invoice/:hash                ->  /app/invoices/[id]     (merchant details)
/                             ->  /                      (landing, keep)
```

Out of phase 1 scope (do not clone yet): `/explorer`, `/dashboard`, `/cards`,
`/giftcards`, `/verify`, `/developer`, `/telegram-*`, `/settings`, `/audit/verify`.

## 2. Create-invoice page (`desktop/pages/createinvoice/index.tsx`)

Two-column layout inside a motion page wrapper:
- Left: `<GlassCard variant="heavy" p-8>` containing `<InvoiceForm/>`.
- Right: empty state until creation finishes, then `<InvoiceCard/>` (share card).
- Bottom: `<USDCxInfo/>` sticky info banner (stablecoin explainer chip).

State comes from one hook, `shared/hooks/invoice/useCreateInvoice.ts`:

```ts
amount, setAmount            // number | ''
invoiceTitle, setInvoiceTitle
memo, setMemo
invoiceType                  // 'standard' | 'multipay' | 'donation'
tokenType                    // 0 CREDITS | 1 USDCX | 2 USAD | 3 ANY
walletType                   // 0 main | 1 burner
selectedAllowedTokens        // string[], multi-token acceptance set
items, showItems, addItem, updateItem, removeItem   // line items
forSdk                       // SDK-dashboard variant toggle
loading, status, invoiceData
handleCreate, resetInvoice
```

Hard validation before submit (copy this discipline):
- wallet connected, amount > 0 (except donation), app unlocked;
- UTF-8 byte limits on title and memo (`leoInputLimits`), error string set into
  `status` inline (not toast).

## 3. InvoiceForm fields, top to bottom (exact order)

1. **Invoice Type** — 3-segment pill control
   (`p-1.5 bg-black/40 rounded-2xl` container, active = filled white/purple/pink),
   each with hover tooltip explaining semantics.
2. **Receiving Wallet** — 2-segment: `Main Wallet` | `🔒 Burner Wallet`
   (emerald when active, disabled until burner exists, tooltip:
   "Payer will not see your real address").
   -> VeilPay analog: this is our `merchantId` pseudonymity. Burner is
   default ON for us (H(merchantSecretKey)), so we can show a single
   read-only "Receiving identity: anonymous (h/…)" row instead of a toggle.
3. **SDK Dashboard toggle** — full-width switch card. Skip in phase 1.
4. **Currency & Settlement** — label + helper "Pick your quote currency and
   enable multi-token payments." Grid of token cards (Aleo Credits / USDCx /
   USAD / Any Token). Active base card is highlighted; non-base cards carry an
   "Accept as payment" toggle row (orange switch). "Any Token" card is pink and
   hides the toggles. Hover tooltip = "Real-time Oracle Conversion" panel
   (Multi-Source Aggregation + ZK Proofs copy).
   -> VeilPay analog: base = `tokenColor` (32-byte; all-zero = open/ANY);
   "Accept as payment" maps to open intent `tokenColor=0x00..00`. Midnight has
   no oracle in v2, so replace the orange tooltip with "Settles in shielded
   NIGHT on preprod".
5. **Amount** — `<label>Amount (TOKEN)</label>` numeric input, placeholder
   `0.00`. Hidden in donation mode.
6. **Title** and **Memo** text inputs with byte counters.
7. **Line items** toggle switch -> row editor `{name, quantity, unitPrice,
   total}`; totals recompute into `amount` on every add/update/remove.
8. **Create Invoice** button (orange, full width) -> `handleCreate()`; while
   pending, `status` string renders as a live progress line.

## 4. InvoiceCard / share state (`shared/components/invoice/InvoiceCard.tsx`)

Shown in the right column after creation succeeds. All inside one centered
`GlassCard p-8`:

1. Gradient pulsing heading (cyan->accent) "Invoice Created".
2. **QR block**: `p-4 bg-white rounded-xl` holding `QRCodeSVG` of the payment
   link, overlaid logo dot; caption "Waiting for payment..." (`text-gray-400`).
3. **Payment Link** row: label, mono truncated link box
   (`bg-black/40 border-white/10 rounded-xl px-4 py-3 font-mono`) + `Copy`
   button -> swaps to "Copied!".
4. **Hash** and **Salt** tiles in a 2-col grid: 10px uppercase labels,
   mono values (cyan / purple), click-to-copy with "Copied!" flash.
5. Hint line: verifiable in Explorer with these credentials.
6. Actions: view invoice link + `resetInvoice`.

-> VeilPay analog: link = `/pay/[intentId]?secret=<paymentSecret hex>`; the
Hash/Salt tiles become **Intent ID** + **Payment secret** tiles (same
click-to-copy). QR value = full payment URL. "Waiting for payment..." polls
`isPaid` / intent status via the public v3 indexer
(`scripts/verify-v2-public.mjs` shows the exact read).

## 5. Hosted checkout (`/checkout/:id`)

`shared/pages/checkout/index.tsx` (~8KB) is thin: `useParams().id` ->
`useCheckoutSession(id)` fetch -> renders `CheckoutUI` with
`useCheckoutPayment` handlers. All visual states live in
`components/CheckoutUI.tsx` (~50KB). State machine, in render order:

1. **loading** — number input styled skeleton (`step="0.01"` placeholder).
2. **amount panel** — session amount with orange quote pill:
   `~ {session.amount} {session.token_type}` (absolute -top-3 -right-16 pill,
   `text-orange-400`, glow shadow) when a cross-token quote exists.
3. **quote expired** — red mono pulsing "Quote expired. Please refresh." +
   refresh CTA.
4. **Payment method segmented**: `Wallet | Gift card | Card`
   (active `bg-white/10 text-white shadow-md`).
5. **wallet unconnected** — Aleo `WalletMultiButton` (white/black rounded-xl
   h-12) inside `[&>button]:!w-full` wrapper.
   -> VeilPay analog: 1AM Connect / Lace button in the same slot.
6. **submitting** — `txId && !success`: spinner + `statusLog` lines streamed
   (`PaymentProgress`-style list).
7. **success** (`success || session.status === 'SETTLED'`) — check,
   "Payment Successful", `text-xs text-gray-500 animate-pulse`
   "Redirecting you back to merchant...".

## 6. Pay page (`desktop/pages/payment/index.tsx`, ~52KB)

The link-target for `/pay` (hash + salt in query). Composed of four panels +
a modal; keep this decomposition:

- `PaymentSummaryPanel` — invoice card readout (merchant, amount, token,
  type badge, title/memo).
- token selector — chips constrained to `invoice.allowedTokens`;
  cross-token pick triggers `checkOracleQuote(base, selected, amount)` and a
  `CONVERT` step (step resets to `PAY` if the user changes token).
- `PaymentNotesPanel` — payer note input, UTF-8 byte-limited
  (`LEO_PAYMENT_NOTE_MAX_BYTES`). -> our payer memo (off-chain, never on intent).
- `PaymentActionPanel` — pay CTA per method (wallet/card/giftcard); wallet path
  calls `payInvoice(selectedToken, { payerNote })`.
- `PaymentProgress` — vertical stepper fed by `statusLog` array.
- `PaymentConversionModal` — quote confirmation before paying a non-base token.
- terminal steps: `SUCCESS`, `ALREADY_PAID` (render success card either way).

-> VeilPay mapping: step machine becomes
`INIT -> CONNECT -> SIGN(pay circuit via gateway /prove) -> SUBMIT -> CONFIRM ->
SUCCESS | ALREADY_PAID(status=PAID) | EXPIRED | CANCELLED`. No CONVERT modal in
phase 1 (no oracle); keep the panel slots so it can be added later.

## 7. Invoice details (`/invoice/:hash`, `shared/pages/invoicedetails/index.tsx` ~74KB)

Merchant/anyone inspection page. Recurring atoms defined at top of file —
reuse these exact shapes:

- `TYPE_INFO` — per-invoice-type badge color map (Standard white / Multi-Pay
  purple / Donation pink, rgba bg+border).
- `TxChip {txId,color,label}` — pill with external-link icon -> explorer.
- `StatCard {label,value,accent,sub}` — uppercase 11px label, big value.
- `AddressRow {label,addr,accent}` — 96px label column + mono address.
- `SectionTitle {icon,title,accent,action}` — uppercase section header.

Page states: `Loading Invoice` (letterspaced uppercase), `Invoice Not Found`,
`Access Denied` (protected detail view, back button), and the resolved view:

- header: title + type badge + status;
- `status: 'PENDING' | 'SETTLED'` drives color + settled copy
  -> ours: `ACTIVE | PAID | REFUNDED | CANCELLED` (4-way badge; ACTIVE maps to
  their PENDING, PAID/REFUNDED map to their SETTLED);
- StatCard grid: Amount, Token (`getTokenLabel(token_type, invoice_type)`),
  Status, creation TxChip (`invoice_transaction_id`);
- AddressRows: recipient / burner address;
- **Receipts section**: auto-scan on load (`handleScanReceipts`) — parses
  merchant receipt records from txs (`parseMerchantReceipt`), matches by
  `invoiceHash`, dedupes by `receiptHash`, renders one row per receipt with a
  `Verify Receipt` action (`handleVerifyReceipt` regex-parses
  `amount:` / `token_type:` from tx plaintext).
  -> ours: v2 contract already writes `receipts: Map<Uint64, Bytes32>` on pay;
  read it straight from contract state (no plaintext regex needed) and show
  receipt hash + paid amount + tx chip.
- **Delete Invoice** — destructive confirm modal
  (`confirmLabel="Delete Invoice"`, "What Happens Next" explainer).
  -> ours: `cancel` circuit (ACTIVE only) + `refund` (PAID) as two menu
  actions, same confirm-modal pattern.

## 8. Style tokens to copy

```css
--bg: #000 / panels rgba(255,255,255,.02-.05) + border rgba(255,255,255,.05-.1)
--neon-primary: #00f3ff   --orange CTA: #f97316 (hover #fdba74)
labels: text-[10-11px] font-bold uppercase tracking-[0.1em-0.22em] text-white/55
values: font-mono, cyan or purple accents, truncate + title= on long hex
controls: rounded-2xl pill groups in p-1.5 bg-black/40 shells; switches
  w-10 h-5 with w-3/4 knob, glow shadow when on
```

## 9. Build order for our agent (phase 1)

1. `/app/invoices/new` — InvoiceForm (type, token->`tokenColor`, amount,
   title/memo, expiry->`expiresAt` sequence bound) wired to
   `createIntent` through the gateway prove path (kit README §create).
2. InvoiceCard share state — QR + copy link + secret tile + status poll via
   `verify-v2-public.mjs` read shape.
3. `/pay/[id]` — Summary + connect (1AM/Lace) + note + pay CTA + progress
   stepper calling the `pay` circuit with the payer's shielded coin.
4. `/app/invoices/[id]` — details page with StatCard grid, receipt list from
   contract `receipts` map, cancel/refund actions.
5. Global: toaster, GlassCard, segmented controls, motion page transitions.

Constraint reminders (from CONTRACT-CARD.md): amounts are `Uint<128>` bigint —
always pass JSON numbers as strings; colors are 32-byte hex; `tokenColor`
all-zero = open intent; never commit `cli/.veilpay-state/`.
