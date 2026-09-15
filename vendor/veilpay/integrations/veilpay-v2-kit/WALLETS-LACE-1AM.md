# Wallets: Lace, 1AM, and the Midnight DApp Connector

What connects to what, and what works on **today's** VeilPay v2. Read the
status lines before building anything wallet-shaped — Phase 1 deliberately
keeps keys server-side.

## Status matrix (do not oversell this)

| Action | Works today | Path |
|---|---|---|
| Merchant creates invoice | YES | server gateway stack (seed-derived keys) |
| Public status read | YES | indexer read, no wallet at all |
| Payer settles invoice | YES via CLI | `preprod-tx2 pay <id> <secret> <value>` (seed's zswap keys) |
| Payer settles in-browser with Lace/1AM | NOT YET | Phase 2, connector surface below |
| Browser wallet read-only (balances/addresses) | YES (connect only) | connector API below |

**Build Phase 1 with the server paths. Wire the browser connect UI as
"connect wallet" + balance display only, and gate the Pay button on
`walletPaySupported = false` until Phase 2 lands.** Agents that skipped this
note wasted hours trying to submit from the browser.

## The DApp Connector contract (verified from `@midnight-ntwrk/dapp-connector-api`)

Wallets that support Midnight (Lace on preprod-capable builds, and any
DApp-Connector-compatible wallet such as the 1AM wallet) inject an **Initial
API** into the page:

```ts
// Each injected wallet instance lives under window.midnight, keyed by UUID.
type InitialAPI = {
  rdns: string;        // stable wallet id, e.g. com.example.wallet
  name: string;        // display name (sanitize before rendering!)
  icon: string;        // URL or base64 data URL (render via <img>)
  apiVersion: string;  // matches an @midnight-ntwrk/dapp-connector-api version
  connect: (networkId: string) => Promise<ConnectedAPI>;  // 'preprod' for us
};
```

After `connect('preprod')` you get `ConnectedAPI = WalletConnectedAPI & HintUsage`
with (verified subset):

```ts
getShieldedBalances(): Promise<Record<TokenType, bigint>>
getUnshieldedBalances(): Promise<Record<TokenType, bigint>>
getDustBalance(): Promise<{ cap: bigint; balance: bigint }>
getShieldedAddresses(): Promise<{
  shieldedAddress: string;           // bech32m
  shieldedCoinPublicKey: string;     // bech32m -- THIS is a merchantCoinPk candidate
  shieldedEncryptionPublicKey: string;
}>
getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>
getTxHistory(pageNumber: number, pageSize: number): Promise<HistoryEntry[]>
balanceUnsealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }>
balanceSealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }>
makeTransfer(desiredOutputs: DesiredOutput[], options?: { payFees?: boolean }): Promise<{ tx: string }>
```

### Discovery snippet (browser)

```ts
const wallets = Object.values(
  (window as any).midnight ?? {},
).filter((w: any) => typeof w?.connect === 'function');
// wallets: [{ rdns, name, icon, apiVersion, connect }, ...]
// Render a picker from name/icon; call connect('preprod') on the chosen one.
```

### Bech32m warning

Connector keys/addresses are **bech32m strings**, not hex. The contract wants
32-byte hex `merchantCoinPk`. Use `@midnight-ntwrk/wallet-sdk-address-format`
to decode (it ships in this repo's lockfile). Do not `Buffer.from(x,'hex')`
a bech32m string.

## Wallet roles in VeilPay today

**Merchant key (server):** derived from `VEILPAY_SEED` via
`@midnight-ntwrk/wallet-sdk-hd` (`Roles.Zswap` gives the coin key pair;
`NightExternal` signs the gateway auth; `Dust` for fees). The gateway stack
builds `providers.walletProvider.getCoinPublicKey()` from these — that is the
`merchantCoinPk` invoices pay to.

**Payer wallet (Phase 2 browser pay):** to settle in-browser the wallet must
supply (a) the `SpendableCoin{nonce,color,value,mtIndex}` — a real shielded
UTXO from its zswap state, (b) proving (hosted `/check`+`/prove` or local),
(c) `balanceUnsealedTransaction` + submit. The SDK pieces exist
(`DAppConnectorWalletAdapter` in testkit-js wraps a connector into a
`WalletProvider`); the browser packaging is the Phase 2 work item.

## 1AM endpoint reality check (for the app, not the deployer)

```text
App runtime (public, verified 2026-09-13):
  Indexer HTTP  https://indexer.preprod.midnight.network/api/v3/graphql
  Indexer WS    wss://indexer.preprod.midnight.network/api/v3/graphql/ws
  RPC           wss://rpc.preprod.midnight.network           <- browser submissions (Phase 2)

Deploy-time only (server, NEVER in the site):
  Gateway       https://api-preprod.1am.xyz  (hosted /check+/prove, sponsored
                DUST /balance-only, authenticated /api/v4/graphql, /rpc/midnight)
  Session       X-Session-Token (Schnorr, cached in cli/.veilpay-state/gw_session.json)
                personal and expiring -- a leak is a compromise, so keep it on the server
```

The live app's read path (public v3 indexer) needs no session token and was
verified against the v2 ledger on 2026-09-13. The write path (create/pay)
currently rides the gateway's hosted proving + sponsored DUST balancing on
the server; Phase 2 replaces server-writes with browser-writes (wallet
extension proving via `getProvingProvider` + `balanceUnsealedTransaction` +
`submitTransaction`, user pays their own fees).

## Funding a demo payer (what NOT to do)

- Do not point users at the public faucet expecting scriptable delivery — its
  Turnstile gate makes automated requests lie about success, and the wallet
  sync then replays the entire zswap history. This is the exact rabbit hole
  that burned hours before the gateway path existed.
- Demo settles go through `preprod-tx2 pay` on the server seed, or real Lace
  wallets once Phase 2 ships.
