# 1AM Gateway Deploy Playbook (any Midnight contract)

The complete, contract-agnostic recipe for deploying **any** Compact contract
to Midnight Preprod through the sponsored 1AM gateway — VeilPay v3, v4, v5, or
a contract that has nothing to do with VeilPay. This is everything we learned
deploying v1 (`0x304666ce…`) and v2 (`0x85a0f911…`), written so a client or
agent never has to rediscover a single one of these failures.

Reference implementation: [`cli/src/gateway-stack.ts`](../cli/src/gateway-stack.ts)
(shared plumbing), [`cli/src/gateway-deploy.ts`](../cli/src/gateway-deploy.ts)
(v1), [`cli/src/gateway-deploy2.ts`](../cli/src/gateway-deploy2.ts) (v2).

## Why the gateway instead of the official path

The vanilla SDK deploy (faucet + `WalletFacade` + local proof server) was
verified broken from a plain developer environment:

1. **Faucet lies.** `POST /api/submit` behind Cloudflare Turnstile returns
   `OK` while minting nothing. We confirmed the unshielded address stayed
   empty on-chain.
2. **Shielded sync stalls.** The wallet SDK replays the whole zswap Merkle
   history; on preprod it throws `Wallet.Sync` before any deploy runs.
3. **Infra requirements.** Local Docker proof server + a live
   `wss://rpc.preprod.midnight.network` websocket, which drops frequently.

The gateway replaces all three: hosted proving, sponsored DUST fee
balancing, and an RPC submit proxy. No faucet, no sync, no Docker.

## Endpoints

| Purpose | URL | Auth |
|---|---|---|
| Session auth | `https://api-preprod.1am.xyz/auth/challenge` + `/auth/verify` | BIP-340 Schnorr sig (below) |
| Circuit check | `POST /check` | `X-Session-Token` |
| Proving | `POST /prove` | `X-Session-Token` |
| Fee balancing | `POST /balance-only` (body = serialized proven tx bytes) | `X-Session-Token` |
| Submit | `POST /rpc/midnight` (JSON-RPC, e.g. `author_submitExtrinsic`) | `X-Session-Token` |
| Indexer (GraphQL v4) | `https://api-preprod.1am.xyz/api/v4/graphql` | `X-Session-Token` |
| Indexer WS | `wss://api-preprod.1am.xyz/api/v4/graphql/ws` (`graphql-transport-ws`) | `X-Session-Token` in connect headers |
| Public RPC (reads only) | `wss://rpc.preprod.midnight.network` | none |
| Explorer | `https://preprod.midnightexplorer.com/contracts/0x…` | none |

The SDK's `httpClientProofProvider` and `indexerPublicDataProvider` speak
these endpoints' native wire formats, which is why no SDK patching is needed.

## Step 0 — Prerequisites

- Node ≥ 22 (we run 24.21), npm workspaces.
- `@midnight-ntwrk/*` SDK 4.1.1: `midnight-js-contracts`,
  `midnight-js-indexer-public-data-provider`,
  `midnight-js-http-client-proof-provider`,
  `midnight-js-node-zk-config-provider`,
  `midnight-js-level-private-state-provider`, `midnight-js-network-id`,
  `midnight-js-protocol` (ledger + compact-runtime), `ledger-v8`.
- `@midnight-ntwrk/wallet-sdk-hd` (key derivation only — never sync).
- `@polkadot/api` + `@midnight-ntwrk/wallet-sdk-node-client` (registers the
  `midnight` pallet types so `api.tx.midnight.sendMnTransaction` encodes).
- `@noble/curves` + `@noble/hashes` (gateway auth).
- `level` + `ws` (private state + indexer relay).
- A 32-byte hex **seed**. This is your identity: the deployed contract's
  deployer is the NightExternal key derived from it. Generate once:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  Provide via `VEILPAY_SEED` env var or `cli/.veilpay-state/wallet.seed`.
  **Never commit it.**
- Compact compiler: you do **not** need it locally. CI compiles via
  `midnightntwrk/setup-compact-action@v1` (compactc 0.31.1, language 0.23.0,
  runtime 0.16.0) and uploads a `veilpay-managed` artifact. compactc ships no
  Windows binary and Docker/WSL may be unavailable — CI is the supported path.

## Step 1 — Write the contract and get managed artifacts

1. Put `<name>.compact` in `contract/src/`.
2. Add a `witnesses<N>.ts` file exporting the private-state type and the
   `witnesses` map (one entry per `secret` witness; see `witnesses2.ts`).
3. Register the compile in `contract/package.json` → `npm run compact`
   (`compact compile src/<name>.compact ./src/managed/<name>`).
4. Export a `CompiledContract` wrapper in `contract/src/index.ts` following
   the existing pattern:

```ts
export const CompiledMyContract = CompiledContract.make<
  MyCompiled.Contract<MyPrivateState>
>("MyContract", MyCompiled.Contract<MyPrivateState>).pipe(
  CompiledContract.withWitnesses(witnessesMy),
  CompiledContract.withCompiledFileAssets("./managed/my-contract"),
);
```

5. Push to `main`; CI compiles, runs vitest against the simulated ledger,
   and uploads `veilpay-managed`. Download the run's artifact and unzip into
   `contract/src/managed/` — this is what the local CLI and API import.
   (`managed/` is gitignored except committed decoders/verifier keys/zkir;
   multi-MB `.prover` files are regenerable.)

## Step 2 — Write the API class

Copy `api/src/index2.ts`. The shape is fixed by `midnight-js-contracts`:

- `static deploy(providers, logger)` → `deployContract(logger, CompiledX,
  providers, …)` then wrap.
- `static join(providers, address)` → `findDeployedContract(...)`.
- Both **require** `providers.privateStateProvider.getSigningKey(address)` to
  exist — the SDK generates/stores a signing key through it
  (`setOrGetInitialSigningKey`). See failure catalog #6 for the browser
  variant of this trap.
- Each circuit call is `deployedContract.circuits.<name>(args).call(...)`
  with the witnesses passed through the private-state helpers.

Type the provider bag (`MyProviders`) in `api/src/common-types.ts` as
`MidnightProviders` with your private-state id union.

## Step 3 — Session auth (once per machine)

Implemented in `gatewaySession()`; contract-agnostic, reuse verbatim:

1. `GET /auth/challenge` → `{ nonce }`.
2. Derive the NightExternal key:
   `HDWallet.fromSeed(seed).selectAccount(0)
   .selectRoles([Roles.NightExternal]).deriveKeysAt(0)`.
3. `msg = sha256("1AM-AUTH-v1\n1am.xyz\n" + nonce + "\n" + unixSeconds)`;
   sign with BIP-340 `schnorr.sign`.
4. `POST /auth/verify { nonce, timestamp, pubkey, signature }` →
   `{ token, address, expires_in }`. Cache in
   `.veilpay-state/gw_session.json`; tokens are long-lived.

Every gateway request afterwards carries `X-Session-Token: <token>`.

## Step 4 — The provider stack

`buildGatewayStack()` builds all six providers; for a new contract copy it
and change only the `zkConfigPath` managed directory and the private-state
store name.

| Provider | Backed by | Gotcha it handles |
|---|---|---|
| `walletProvider` | HD-derived `ZswapSecretKeys.fromSeed(seed)`; `balanceTx` posts the **serialized proven tx** to `/balance-only` | Gateway sponsors the DUST fee. On `503 WALLETS_UNAVAILABLE / DUST_SYNC_STALE`, honor `retryAfterMs` and back off (we retry ×10, capped 30s). It returns `{ txBytes, txHash }` — **record `txHash`**; Step 6 needs it. |
| `midnightProvider` | `@polkadot/api` over `HttpProvider(GATEWAY + "/rpc/midnight")`, then `POST author_submitExtrinsic` with `api.tx.midnight.sendMnTransaction(0x…)` | `HttpProvider` has no subscriptions, so `.send()` is out; encode → JSON-RPC POST. Init burst is rate-limited: race `ApiPromise.create` against a 45s timeout and retry with exponential backoff. |
| `proofProvider` | `httpClientProofProvider(GATEWAY, zkConfigProvider, { headers })` | Wire-compatible with hosted `/check` + `/prove`. The field is `proofProvider` (not `provingProvider`) and `midnightProvider` is also mandatory — omit either and `findDeployedContract` fails. |
| `publicDataProvider` | `indexerPublicDataProvider(relay.httpUrl, relay.wsUrl)` wrapped by `withPollingWatches` | See Steps 5–6. |
| `privateStateProvider` | `levelPrivateStateProvider` with a custom `levelFactory` | npm resolves two abstract-level majors (provider 3.x vs level@8 1.x) — cast the factory; runtime API is compatible. Keep stores under `STATE_DIR` (cwd is read-only on serverless). Pass `signingKeyStoreName` + `privateStoragePasswordProvider` + `accountId`. |
| `zkConfigProvider` | `NodeZkConfigProvider(managed/<name>)` | Reads `decoders/`, `keys/*.verifier`, `zkir/*.bzkir` produced in Step 1. |

Call `setNetworkId('preprod')` **before** anything touches the SDK.

## Step 5 — The indexer relay

The SDK's indexer provider cannot attach auth headers, so run a tiny
localhost HTTP + `graphql-transport-ws` relay (see `startIndexerRelay`) that
injects `X-Session-Token` upstream. Bind port 0 (random), hand the SDK
`http://127.0.0.1:<port>/api/v4/graphql` and `ws://127.0.0.1:<port>/ws`.
Queue client frames until the upstream socket opens.

## Step 6 — The inclusion-watch fix (the one real bug)

`submitTx` returns the **extrinsic** hash; the SDK's `watchForTxData` then
polls the indexer by Midnight **identifier** — they never match, so every
transaction hangs forever *after succeeding on-chain*. Verified live:

```
transactions(offset:{identifier: <either hash>})  -> []
transactions(offset:{hash: <midnight tx hash>})   -> SUCCESS
```

Fix (already in `withPollingWatches`, copy verbatim for new contracts):

- `watchForTxData(txId)`: pop the Midnight `txHash` that `/balance-only`
  reported for this tx (FIFO is safe — balance → submit → watch is strictly
  sequential in midnight-js) and poll
  `transactions(offset:{hash:"0x<hash>"})` every 3s until it returns a
  `RegularTransaction`, mapping `transactionResult.status` to
  `SucceedEntirely / FailFallible / FailEntirely`.
- `watchForDeployTxData(address)`: poll
  `contractAction(address){ ... on ContractDeploy { transaction } }`. When
  the deploy tx hash is known (gateway deploys always know it), poll by hash
  instead — the address lookup is flaky on recent contracts (their own notes
  admit this too).

## Step 7 — Deploy script + wiring

```ts
const { providers, session, close } = await buildGatewayStack(logger, { version: 'v3' });
const api = await MyContractAPI.deploy(providers, logger);
fs.writeFileSync(ADDRESS_FILE_V3, api.deployedContractAddress);
await close();
```

Add a `cli/package.json` script (`preprod-gateway3`) and an
`ADDRESS_FILE_V3` in `gateway-stack.ts`. Run:

```bash
npm --workspace cli run preprod-gateway3
```

Success looks like: session established → relay listening → `/check`+`/prove`
→ `/balance-only` (hash logged) → `author_submitExtrinsic` → polling watch
resolves → printed contract address.

## Step 8 — Record + verify

Write `deployments/preprod-v3.json` following
[`preprod-v2.json`](../deployments/preprod-v2.json): address, deploy tx,
block, timestamp, source sha256, compiler/language/runtime versions, per
circuit argument + witness lists and verifier-key hashes, public-read
layout, endpoints, deployment path, test status, token support.

Verify independently (never trust your own client):

```bash
# direct ledger read (works even when indexer lookups flake)
node scripts/verify-v2-live.mjs   # copy per contract
# explorer
curl -s "https://preprod.midnightexplorer.com/api/contracts/0x<addr>"
# indexer by hash
curl -s https://api-preprod.1am.xyz/api/v4/graphql \
  -H "X-Session-Token: $TOKEN" -H 'content-type: application/json' \
  -d '{"query":"query($o:TransactionOffset!){transactions(offset:$o){hash block{height} transactionResult{status}}}","variables":{"o":{"hash":"0x<dtx>"}}}'
```

## Failure catalog

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Faucet says `OK`, balance stays 0 | Cloudflare Turnstile gate accepts any scripted POST, mints nothing | Don't use the faucet; gateway sponsors fees |
| 2 | `Wallet.Sync` throw / endless sync | zswap history replay on preprod | `ZswapSecretKeys.fromSeed` directly, never `WalletFacade` |
| 3 | Deploy/call hangs after submit | extrinsic-hash vs identifier mismatch | Step 6 polling watches |
| 4 | `/balance-only` 503 `DUST_SYNC_STALE` | gateway's dust wallet transiently stale | retry with server `retryAfterMs`, backoff |
| 5 | `ApiPromise.create` never resolves | RPC proxy rate-limits the init burst | 45s race + exponential backoff retries |
| 6 | `getSigningKey is not a function` | custom (browser) private-state provider missing the two signing-key methods the SDK's `setOrGetInitialSigningKey` calls | implement `getSigningKey`/`setSigningKey` (+ remove/clear) on the provider — see `lib/veilpay/client.ts` in the Next.js web app |
| 7 | Join fails with key-material errors through the extension | connector copies the key-material provider, losing prototype methods | return a plain object with **own-property** methods incl. batched `getVerifierKeys` (see `ManagedCircuitZKConfigProvider.asKeyMaterialProvider`) |
| 8 | Contract rejects the coin public key | extension returns bech32m | decode to raw 32 bytes (`bech32mDecode` in the web app client) |
| 9 | `contractAction(address)` returns null for a fresh contract | gateway indexer replication lag | poll by deploy tx hash instead; fall back to `queryContractState` |
| 10 | leveldb `LOCK` errors | two abstract-level majors + shared cwd | custom `levelFactory` writing under `STATE_DIR`, cast across majors |
| 11 | "Invalid Transaction" on resubmit | re-submitting a spent dust input (stale balance) | rebuild the tx; never replay serialized txs |
| 12 | `compactc` unavailable on Windows | no official Windows binary | compile in CI (`setup-compact-action@v1`), download artifact |

## Browser variant (no CLI)

For in-browser issuance/reads (merchant dashboard), the same endpoints apply
but the wallet provider is the Lace extension via
`@midnight-ntwrk/dapp-connector-api`: `balanceUnsealedTransaction` +
`submitTransaction` replace `/balance-only` + RPC; proving goes through
`dappConnectorProofProvider`; circuit artifacts are served from
`public/veilpay/managed/`. The private-state provider **must** include the
signing-key methods (catalog #6). The public indexer works unauthenticated
for reads: the 1AM v4 HTTP endpoint or `indexer.preprod.midnight.network`.

## Quick checklist for a new contract

```
[ ] .compact + witnesses + CompiledContract wrapper
[ ] CI compiles → managed/ artifact downloaded
[ ] API class with deploy/join + circuit methods
[ ] buildGatewayStack(version) → new managed dir + store name
[ ] gateway-deploy<N>.ts + npm script + ADDRESS_FILE_V<N>
[ ] deploy → print address
[ ] deployments/preprod-v<N>.json written
[ ] verify script + explorer + indexer-hash confirmation
[ ] smoke call (create/status) through the same stack
```
