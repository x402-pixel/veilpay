# VeilPay v2 Integration API (copy-paste, verified signatures)

Every snippet here mirrors real code in this repo:
`cli/src/gateway-stack.ts` (providers), `api/src/index2.ts` (VeilPay2API),
`cli/src/gateway-cli2.ts` (lifecycle driver). If your generated code does not
match these signatures, your code is wrong — fix yours first.

## Prerequisites (one-time)

```bash
git clone https://github.com/thirdbase1/veilpay.git && cd veilpay
npm install
npm run compact            # or download the CI artifact `veilpay-managed`
                           # (managed/ dirs are gitignored; CI builds both
                           #  veilpay and veilpay2 with compactc 0.31.1)
```

State the server needs (gitignored, never commit):

```text
cli/.veilpay-state/wallet.seed        64-hex seed; or env VEILPAY_SEED
cli/.veilpay-state/gw_session.json    cached gateway session (auto-created)
cli/.veilpay-state/contract-address-v2  the v2 address above (already set)
```

## Provider stack + API singleton

`lib/veilpay-v2-server.ts` — build once per process, reuse everywhere:

```ts
import fs from 'node:fs';
import { VeilPay2API } from '../../veilpay/api/src/index2.js';
import { type VeilPay2Providers } from '../../veilpay/api/src/common-types.js';
import {
  buildGatewayStack,
  ADDRESS_FILE_V2,
} from '../../veilpay/cli/src/gateway-stack.js';

const logger = { info: (m: string) => console.log('[veilpay-v2]', m) } as never;

let ready: Promise<{ api: VeilPay2API; providers: VeilPay2Providers }> | null = null;

export function veilpayV2(): Promise<{ api: VeilPay2API; providers: VeilPay2Providers }> {
  if (!ready) {
    ready = (async () => {
      const { providers } = await buildGatewayStack(logger, {
        version: 'v2',
        privateStateStoreName: 'veilpay2-private-state',
      });
      const address =
        process.env.VEILPAY_CONTRACT_ADDRESS_V2 ??
        fs.readFileSync(ADDRESS_FILE_V2, 'utf8').trim();
      const api = await VeilPay2API.join(providers, address, logger);
      return { api, providers };
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
```

## Exact API surface (`VeilPay2API`, api/src/index2.ts)

```ts
VeilPay2API.join(providers, contractAddress, logger?) : Promise<VeilPay2API>
VeilPay2API.deploy(providers, logger?)                : Promise<VeilPay2API>

api.createIntent(
  amount: bigint,           // Uint<128>, minor units
  expiresAt: bigint,        // Uint<64>, sequence bound: currentSequence + ttlOps
  tokenColor: Uint8Array,   // exactly 32 bytes; all-zero = open intent
  merchantCoinPk: Uint8Array, // 32-byte zswap coin pubkey receiving payment
  paymentSecret: Uint8Array,  // 32 random bytes YOU generate, share with payer
): Promise<bigint>          // intent id (Uint<64>)

api.pay(intentId: bigint, paymentSecret: Uint8Array, coin: SpendableCoin): Promise<void>
// SpendableCoin = { nonce: Uint8Array; color: Uint8Array; value: bigint; mtIndex: bigint }

api.refund(intentId: bigint, refundAmount: bigint): Promise<void>
api.cancel(intentId: bigint): Promise<void>
api.isPaid(intentId: bigint): Promise<boolean>
api.state$: Observable<Intent2View[]>   // live list, includes `isMine` for dashboard
api.deployedContractAddress: string
```

## Create invoice route (Next.js App Router)

`app/api/invoice/route.ts` — complete and self-contained. This is the exact
pattern the working CLI (`preprod-tx2 create`) uses, so it cannot drift:

```ts
import { NextResponse } from 'next/server';
import { veilpayV2 } from '@/lib/veilpay-v2-server';

export const dynamic = 'force-dynamic';

const hexToBytes = (s: string): Uint8Array =>
  new Uint8Array(Buffer.from(s.replace(/^0x/, ''), 'hex'));

const hexToBytes32 = (s: string, label: string): Uint8Array => {
  const b = hexToBytes(s);
  if (b.length !== 32) throw new Error(`${label} must be 32 bytes of hex`);
  return b;
};

export async function POST(req: Request) {
  const body = (await req.json()) as {
    amount: string;      // decimal string, e.g. "2500"
    ttlOps?: string;     // sequence bound, default "1000"
    tokenColor?: string; // 64-hex; omit for an open (any-token) invoice
  };
  try {
    const { api, providers } = await veilpayV2();
    const { randomBytes } = await import('../../veilpay/api/src/utils/index.js');

    // 1. Anchor expiry against the live sequence (NOT wall clock).
    const { ledger } = await import(
      '../../veilpay/contract/src/managed/veilpay2/contract/index.js'
    );
    const state = await providers.publicDataProvider.queryContractState(
      api.deployedContractAddress,
    );
    if (!state) throw new Error('contract state not found');
    const sequence = ledger(state.data).sequence;

    // 2. Your receiving coin public key (32 bytes, from the server seed).
    const merchantCoinPk = hexToBytes32(
      String(providers.walletProvider.getCoinPublicKey()),
      'merchantCoinPk',
    );

    // 3. The payment secret is generated HERE and only leaves via the
    //    response/URL. Persist { id -> paymentSecret, orderRef } in your DB.
    const paymentSecret = randomBytes(32);

    const id = await api.createIntent(
      BigInt(body.amount),
      sequence + BigInt(body.ttlOps ?? '1000'),
      body.tokenColor ? hexToBytes32(body.tokenColor, 'tokenColor') : new Uint8Array(32),
      merchantCoinPk,
      paymentSecret,
    );

    return NextResponse.json({
      id: id.toString(),
      paymentSecret: Buffer.from(paymentSecret).toString('hex'),
      payUrl: `/pay/${id.toString()}?s=${Buffer.from(paymentSecret).toString('hex')}`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

Note on the sequence anchor: between the read and the submit, another write
could shift the id the commitment registers under. `VeilPay2API.createIntent`
already reads the sequence itself and registers the secret at `sequence + 1`
before submitting (api/src/index2.ts), so on a single server with the write
lock below, the anchor here is consistent. If you run multiple server
instances against one merchant store, run only ONE writer.

## Pay route (customer settles server-side in Phase 1)

`app/api/invoice/[id]/pay/route.ts`:

```ts
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { paymentSecretHex, coin } = (await req.json()) as {
    paymentSecretHex: string;
    coin: { nonce: string; color: string; value: string; mtIndex: string };
  };
  const { api } = await veilpayV2();
  await api.pay(
    BigInt(params.id),
    hexToBytes(paymentSecretHex),
    {
      nonce: hexToBytes(coin.nonce),
      color: hexToBytes(coin.color),
      value: BigInt(coin.value),
      mtIndex: BigInt(coin.mtIndex),
    },
  );
  return Response.json({ ok: true });
}
```

Where does a `coin` come from? Today: the server demo wallet (seed-derived
zswap keys) — see WALLETS-LACE-1AM.md. In Phase 2 the payer's own wallet
supplies it. There is no way to conjure a coin from an unsigned amount; the
circuit consumes a real shielded UTXO.

## Status route

`app/api/invoice/[id]/route.ts` — pure read, no keys (PUBLIC-READS.md).

## Concurrency rule (real bug source, read this)

The gateway stack balances/submits/watches transactions **in FIFO order**
(`pendingMidnightHashes.shift()`). Two simultaneous writes through the same
stack can cross their inclusion watches. **Serialize all `callTx` operations
behind one promise queue** per provider stack:

```ts
let tail: Promise<unknown> = Promise.resolve();
export const withWriteLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
};
```

Wrap `createIntent` / `pay` / `refund` / `cancel` calls in it. Reads never
need the lock.

## Merchant identity rule (second real bug source)

`VeilPay2API.join` generates a fresh random `merchantSecretKey` into the
private-state store **if the store is empty**. Your merchant identity
(`merchantId` on-ledger) is `H(merchantSecretKey)` — if the leveldb store is
deleted or the container restarts without a persistent volume, you become a
different merchant and `refund`/`cancel` on old invoices will fail the
circuit's ownership check. Persist `cli/.veilpay-state/` (or the browser
IndexedDB equivalent) and back it up. One merchant, one store, one process.

## Error table

| Symptom | Cause | Fix |
|---|---|---|
| `Do not know how to serialize a BigInt` | `JSON.stringify` on raw intent | `.toString()` every bigint (see status shape) |
| create hangs after "submitted via gateway rpc" | indexer inclusion poll transient | retry; check `watchForTxData: polling indexer by hash 0x...` log line |
| `tokenColor must be 32 bytes` | color passed as 0x0 / wrong length | 32 zero bytes for open, full 64-hex otherwise |
| `pay` rejects with "invalid payment secret" | secret not the one committed at create | read the secret from your DB by intent id; never regenerate |
| `refund`/`cancel` ownership failure | merchant store regenerated | restore persisted private-state store (rule above) |
| Two invoices "swap" confirmations | concurrent writes | write lock (rule above) |
| `503 WALLETS_UNAVAILABLE` from /balance-only | gateway dust sync transient | built-in retry; if persistent, wait — it self-heals |
| `Wallet.Sync` throw (faucet path) | you used the vanilla faucet deploy path | you don't need it; use `buildGatewayStack` (deploy-time notes in docs/DEPLOYMENT.md) |
| join throws `indexer has no deploy tx for <addr> within 240s` | gateway `contractAction(address)` returns the *latest* action — a ContractCall once any intent exists — so the by-address deploy poll never matches | pass `deployTxHash` (from `deployments/preprod-v2.json` / `VEILPAY_DEPLOY_TX`) to `buildGatewayStack`, or use the vendored stack which also follows `ContractCall { deploy { transaction } }`. Verified live 2026-09-14: join completes in ~2s by hash |
| `/check` returns `500 {"error":"deserialize: expected header tag 'midnight:(proof-preimage-versioned,...)'"}` | the request BODY is not a valid proof preimage (CBOR). This is NOT the session token — a bogus token gives the identical 500, and a valid token with garbage gives the same. The hosted prover itself is healthy (our own createIntent proved + landed intent #2 live on 2026-09-14 through the same endpoint) | send `createCheckPayload(preimage, ir)` bytes from `midnight-js-protocol/ledger` via `httpClientProofProvider(GATEWAY, zkConfig, { headers: { 'X-Session-Token' } })`; never hand-POST JSON |
| `Invalid Transaction (code 1010)` on submit, repeats with identical inputs | stale dust nonce from a previous unconfirmed/abandoned balanced tx for this session | change the tx inputs (different amount/ttl) and resubmit — the next /balance-only mints fresh dust and it goes through. Confirmed 2026-09-14: two rejects at amount=100/ttl=50, immediate success at 137/77 |
