/*
 * Read the deployed VeilPay v2 contract through the OFFICIAL PUBLIC preprod
 * v3 indexer. No gateway session, no seed, no keys -- this is exactly the
 * read path the live website should use (and the one verified live on
 * 2026-09-13: sequence=1, intent #1 ACTIVE amount=2500).
 *
 * Usage (from the repo root, after `npm install`):
 *   node --experimental-specifier-resolution=node scripts/verify-v2-public.mjs
 */
import { WebSocket } from 'ws';

globalThis.WebSocket = WebSocket;

const INDEXER = 'https://indexer.preprod.midnight.network/api/v3/graphql';
const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
const ADDRESS =
  process.env.VEILPAY_CONTRACT_ADDRESS_V2 ??
  '85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7';

const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
setNetworkId('preprod');
const { indexerPublicDataProvider } = await import(
  '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
);
const { ledger, IntentStatus } = await import(
  '../contract/src/managed/veilpay2/contract/index.js'
);

const provider = indexerPublicDataProvider(INDEXER, INDEXER_WS);

let state = null;
for (let attempt = 1; attempt <= 5 && !state; attempt++) {
  state = await provider.queryContractState(ADDRESS);
  if (!state) await new Promise((r) => setTimeout(r, 3000));
}
if (!state) {
  console.error('NO STATE at', ADDRESS);
  process.exit(1);
}

const L = ledger(state.data);
const STATUS = ['ACTIVE', 'PAID', 'REFUNDED', 'CANCELLED'];
console.log('VEILPAY v2 via PUBLIC v3 INDEXER (no session, no keys)');
console.log('address  :', ADDRESS);
console.log('sequence :', L.sequence.toString());
for (let i = 1n; i <= L.sequence; i++) {
  if (!L.intents.member(i)) continue;
  const it = L.intents.lookup(i);
  console.log(
    `  #${i} status=${STATUS[Number(it.status)] ?? IntentStatus[it.status]}` +
      ` amount=${it.amount} paid=${it.paidAmount}` +
      ` receipt=${L.receipts.member(i)}`,
  );
}
process.exit(0);
