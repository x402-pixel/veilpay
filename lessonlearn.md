# VeilPay — Lessons Learned

> Living document. Update it whenever a new lesson, bug, workaround, or environment
> quirk is discovered. Newest entries at the top of each section.

---

## 1. Midnight Gateway / Contract (v3)

### Versioned invoice protocol boundary (Sep 16)
- The active create/pay path is the v2 wallet-issuance flow. v3 remains a
  separate contract family and must not be selected by inference from fields
  like `salt` or `tokenColor`.
- Added `lib/payments/protocol.ts` with explicit `v1 | v2 | v3` discriminators,
  active-protocol gating, legacy-record fallback to v2, and protocol mismatch
  errors. New records persist `metadata.protocolVersion`; API responses expose
  `PaymentIntent.protocolVersion`.
- Create rejects unsupported/inactive protocol requests instead of silently
  sending v3-shaped data to the v2 verifier. Pay rejects non-v2 records until a
  dedicated v3 verifier is enabled. This keeps future adapters additive and
  prevents cross-contract settlement.
- The upstream judge snapshot is excluded from the app TypeScript program so
  its original tests remain byte-for-byte intact without requiring the upstream
  repository's Vitest dependency.

### Judge-facing upstream contract snapshot (Sep 16)
- Imported all 89 files from `https://github.com/thirdbase1/veilpay` (`contract/` at
  the fetched HEAD) into `contracts/veilpay-upstream/`, preserving the complete
  source/test/package tree and managed artifacts for `veilpay` (v1), `veilpay2`,
  and `veilpay3`.
- Keep this snapshot separate from `vendor/veilpay/`: the explicit project-root
  path makes the contract implementations and compiled ZK artifacts easy for
  judges to inspect without depending on a nested vendored repository.

### Two separate wallet states caused "disconnected" despite connected wallet (Sep 16)
- VeilPay has TWO independent wallet surfaces: (1) the Supabase AUTH session
  (`OneAmWalletButton` reads `supabase.auth.getSession()` — what the nav shows)
  and (2) the DAPP-CONNECTOR context (`WalletProvider` in `lib/wallet/context.tsx`
  — what the sidebar "Merchant Wallet" line and invoice issuance read). Being
  signed in does NOT mean the connector context is connected.
- Bug: `WalletProvider` only auto-restored from `localStorage['veilpay.connectedWalletId']`,
  which is written ONLY by the extension login flow (`WalletConnectForm`). A
  merchant signed in without that key (cleared storage, restore failed once and
  the key was removed, or a different sign-in path) stayed disconnected forever:
  sidebar showed "Disconnected" and `createPaymentIntentApi` threw
  "Connect your Midnight wallet…".
- Fix: session-aware silent restore in `WalletProvider` — when an extension is
  detected and the merchant has an authenticated Supabase session, auto-connect
  the first detected wallet (best-effort, silent on failure). The stored-rdns
  preference still wins when present. Gate the no-preference auto-connect on the
  auth session so anonymous visitors never get a surprise extension prompt.
- Also added an inline "Connect wallet" banner in `IntentBuilder` when the
  connector is disconnected, so the merchant can fix it in one click instead of
  hitting the dead-end submit error.
- Lesson: when a UI reports "wallet disconnected" but the user insists it is
  connected, check WHICH wallet state each component reads — auth session vs
  dapp-connector context are different stores and can diverge silently.

### Branch merge vs main's client-side issuance (Sep 15)
- main moved issuance CLIENT-SIDE (`076e4ab`: merchant's wallet extension signs
  `createIntent`, server only verifies against the public ledger + registers)
  and DELETED `lib/veilpay-v2-server.ts`. Our v3-integration branch had built
  SERVER-side issuance on the gateway stack — directly contradictory.
- Resolution: main's architecture wins (it avoids server-held keys and the
  gateway/prover at issuance time). Reverted to main/merge-base versions:
  intents route (verification+registration), [id]/cancel/pay routes, browser
  `client.ts`, `checkout-action.tsx`. The v3 work survives as dormant,
  non-interfering additions: vendor kit (compiled), `lib/veilpay-v3-server.ts`
  (self-contained, unused), v3 contract address in config, ZK artifacts in
  `public/veilpay/managed-v3/`, and the lessonlearn/vendor knowledge.
- Lesson: before building on a vendored stack, check whether the base branch's
  architecture still matches — a parallel "fix" on main can invalidate an
  entire integration approach. Reconcile by adopting the base branch's
  decision and keeping the alternative as dormant, compiling code.

### v3 integration (Sep 15) — private invoices via commitment
- v3 contract `0xaad2cd8b9a98c9b8f7c6f3edd562d895705c19d24eb122c5253b22187e950772`
  (upstream `deployments/preprod-v3.json`). Unlike v2, the ledger stores ONLY a
  commitment — amount, token color, merchant coin key, invoice type, payment
  secret and salt all live in private witnesses proven at settlement.
- Issuance: `api.issueInvoice({ amount, tokenColor, merchantCoinPk, invoiceType,
  expiresAt })` — the API generates the payment secret + salt and returns them;
  the server MUST persist them in intent metadata (they are the checkout link's
  opening data). Payer reconstructs the opening client-side via
  `buildOpeningParams()` in `components/checkout/checkout-action.tsx`.
- Upstream type bug: `VeilPay3CircuitKeys` in `api/src/common-types.ts` listed
  `isSettled` as an impure circuit — it is a PURE ledger read, so including it
  breaks `findDeployedContract`'s provider type check. Patched in vendor; do not
  re-add it when merging upstream.
- v3 CLI needs the contract address via env after a sandbox reset wiped the
  state file: `VEILPAY_V3_CONTRACT_ADDRESS=<hex> node cli/src/gateway-cli3.js …`.
- Hosted prover `api-preprod.1am.xyz` returned 500 on v3 `issueInvoice` proving
  (same outage pattern as v1/v2). Ledger READ path (join + status) works without
  the prover — verify reads when the write path is blocked.
- ZK artifacts for the browser path are copied to `public/veilpay/managed-v3/`
  (zkir + keys) from `vendor/veilpay/contract/src/managed/veilpay3/`.

### Sandbox reset recovery via git objects
- A sandbox reset replaced the working tree with upstream content, but app
  commits survived in git objects: `git reflog` / `git cat-file -t <hash>` to
  find the last good app commit, then `git checkout -f -b <branch> <hash>`.
  Save uncommitted work (compiled vendor, edited package.json) to /tmp BEFORE
  the forced checkout — uncommitted changes block/are destroyed by it.
- Never `cp -R` a repo WITH its nested `.git` into the project root — the
  nested `.git` hijacks subsequent git commands (checkout hit the outer repo
  and wiped the app tree). Strip `.git` when vendoring.

### Indexer deploy-by-address lookup is unreliable
- `contractAction(address:)` on the gateway indexer returns `__typename: "ContractCall"`
  for long-deployed contracts. The vendor's `DEPLOY_TX_QUERY` only fragments
  `ContractDeploy` / `ContractUpdate`, so `transaction` is always null and
  `pollDeployTx` times out after 240s with "indexer has no deploy tx".
- **Fix:** pass the known deploy tx hash into the stack —
  `buildGatewayStack(logger, { version: 'v2', privateStateStoreName, deployTxHash: process.env.VEILPAY_DEPLOY_TX })`
  — so `withPollingWatches` polls by hash instead. Wired in `lib/veilpay-v2-server.ts`.
- To resolve a contract address from a deploy tx hash, query
  `transactions(offset: { hash: "0x…" })` (offset is an **object**, not a string) and
  read `contractActions[0].address`.

### Wasm type identity: never allow two copies of onchain-runtime
- `createIntent` threw `expected instance of StateValue` because TWO versions of
  `@midnight-ntwrk/onchain-runtime-v3` were installed: `midnight-js-protocol` pins
  exact `3.0.0` while `compact-runtime`'s `^3.0.0` floated to `3.1.1`. Wasm classes
  from one copy fail `instanceof` checks in the other.
- **Fix:** pnpm override in root `package.json`:
  ```json
  "pnpm": { "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.1.1" } }
  ```
- Diagnose with `pnpm why <pkg>` and
  `ls node_modules/.pnpm/ | grep <pkg>`; verify with `readlink` on the consumers'
  `node_modules` symlinks.

### Leveldb self-flock in private-state provider
- `midnight-js-level-private-state-provider`'s `withSubLevel` opens **and closes** a
  fresh Level per operation. Concurrent ops (encryption-salt init racing get/set)
  double-open the same path → `lock already held by process`.
- **Fix:** in `vendor/veilpay/cli/src/gateway-stack.js`, the `levelFactory` caches one
  Level instance per dbName and neuters `close()` (single handle for process lifetime).
- After killing hung node processes, stale `LOCK` files must be removed:
  `pkill -f "input-type=module"; rm -f <state-dir>/private-state/midnight-level-db/LOCK`.

### Hosted prover outage (upstream, unresolved)
- `api-preprod.1am.xyz` hosted prover `/check` returns **500** for v1 AND v2
  `createIntent` circuits. Service itself is up (deserialize errors prove it) — only
  circuit checks fail. First seen Sep 12; re-confirmed Sep 13 with a fresh gateway
  session. Persistent, not transient.
- Upstream v1 deploys used a LOCAL proof server; v2 docs claim hosted works.
- **Mitigation shipped:** `app/api/intents/route.ts` catches prover failures and
  returns a retryable **503** with an upstream-outage message instead of a generic 500.
- Everything else works end-to-end: gateway auth, join (with deployTxHash), ledger
  reads (`VeilPay2.ledger(state.data).sequence`), tx construction.

### v2 contract facts
- Contract `0x85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7`,
  deploy tx `0x80bc77767f62fe711c8f1095a261f5a5296de665d2523850ab9afdf8e5982ad2`
  (env `VEILPAY_DEPLOY_TX`). v1 (`0x304666ce…`) creation is broken at the hosted prover.
- `createIntent(amount, expiresAt, tokenColor, merchantCoinPk, paymentSecret)`;
  zero tokenColor = open intent. `pay()` needs a spendable zswap coin (payer wallet =
  upstream Phase 2; app returns 503 PAYER_WALLET_REQUIRED until env coin configured).
- Sponsored gateway: `api-preprod.1am.xyz` — hosted `/check`+`/prove` (binary
  compact-prover IR, NOT JSON), indexer GraphQL at `/api/v4/graphql` with
  `X-Session-Token`.
- Real ledger sequence must be read via `VeilPay2.ledger(state.data)` from
  `vendor/veilpay/contract/src/managed/veilpay2/contract/index.js` — `state.data.sequence`
  on the raw query result is NOT the ledger value.

---

## 2. Wallets (dApp Connector v4)

- Midnight wallets inject under **UUID keys** on `window.midnight` (CAIP-372), NOT
  `mnLace` / `'1am'`. Each entry: `{ rdns, name, icon, apiVersion, connect(networkId) }`.
- v4 ConnectedAPI: address via `getUnshieldedAddress()` → `{ unshieldedAddress }`;
  transfers via `makeTransfer([{ kind, type, value, recipient }])` — field is `type`,
  not `tokenType`.
- 1AM rdns: `xyz.oneam.wallet`; Lace Midnight rdns: `io.lace.midnight`.
- App is testnet-oriented (tDUST, preprod); `connect()` tries preview → preprod →
  undeployed → mainnet.
- There were TWO wallet implementations (login vs dashboard); both now share
  `lib/wallet/detect.ts`. Keep it that way.
- Extension API has no coin discovery yet → `selectPayerCoin()` returns null →
  checkout honestly reports FUNDING_REQUIRED (payer funding is upstream Phase 2).

---

## 3. Sandbox / Environment Gotchas

- **Sandbox resets revert tracked files to HEAD and wipe untracked files** — commit
  work promptly. Project-level env vars (`vercel env`) survive resets; local
  `.env.development.local` edits get clobbered by env sync.
- `VEILPAY_SEED` is NOT in the bash shell even though it's a project env var —
  pull it with `vercel env pull /tmp/.env.local --yes --scope team_UflisaMXde8wGsQefVURM1YE`
  then `set -a && . /tmp/.env.local && set +a`.
- `VEILPAY_SEED` must be 64-char hex; managed at project level (all environments).
- `rm -rf` is blocked in Bash (use the Delete tool); `rm -f` on single files is fine.
- Background Bash tasks buffer output through grep filters — write to a log file
  (`> /tmp/x.log 2>&1`) and `tail` it instead, or stack traces get stripped.
- `user_read_only_context/` files cannot be accessed via Bash — use the Read tool.
- The git remote in the sandbox is a stale v0-internal bundle; commits stay local and
  v0 persists project state directly. Ship via the Publish button.
- Vendor tree `vendor/veilpay` (upstream thirdbase1/veilpay) is compiled in place with
  tsc; extensionless imports were fixed for ESM. `gateway-bootstrap.mjs` exports
  `VeilPay2API` + `ledger2`.
- Turbopack can't bundle `isomorphic-ws` — use shim `lib/shims/isomorphic-ws.ts`
  referencing `globalThis.WebSocket` (a bare `typeof WebSocket` check collides with
  the module's own export).

---

## 4. Process / Debugging Patterns

- When a stack trace matters, don't pipe node output through `grep` filters in
  background tasks — capture full output to a file first.
- To see what a failing HTTP call actually returned, monkey-patch `globalThis.fetch`
  in the test script and log status + body (works for JS-level calls; NOT for calls
  made inside wasm).
- Error strings that live inside wasm binaries can't be found with rg — get the full
  JS stack trace instead and work backwards from the throwing wrapper.
- Version-identity bugs (instanceof failures across the same class) almost always mean
  duplicate package copies — check `node_modules/.pnpm/` before suspecting the code.
- Typecheck (`pnpm exec tsc --noEmit`) + production build (`pnpm build`) + curl smoke
  of key routes is the minimum verification before declaring done.

---

## 5. Product / Architecture Decisions

- Server-side issuance is the primary path (browser wallet issuance dropped from the
  merchant UI); client-side issuance (`lib/veilpay/client.ts` `issueInvoice`) remains
  for extension-signed flows with proving keys served from `/veilpay/managed/`.
- Public read layer is indexer-only — no gateway session in runtime read paths.
- Vocabulary: explorer shows numeric `invoice #N` ids, merchantCoinPk first-6 masking,
  token-color labels ("open" for zero color); "Settled Volume" stat dropped (mixed
  colors make sums meaningless) → replaced with Expired count.
- Checkout link accepts `?secret=` (canonical) + `#ps=` fragment.
- Remaining roadmap items: payer coin funding/discovery (blocks live pay demo — demo
  against simulator until then), merchant onboarding must collect zswap coin pk
  (NOT mn_addr), optional Supabase side table for merchant metadata labels, retry
  v3 issuance end-to-end once the hosted prover outage clears (read path already
  verified live against the v3 contract).
