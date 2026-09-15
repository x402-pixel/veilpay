// Baseline: prove a v2 createIntent through the same gateway. If this works and
// the v3 issueInvoice does not, the failure is in the v3 circuit/witnesses.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await realFetch(url, { ...options, signal: undefined });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
};

const { VeilPay2API } = await import('./cli/dist/api/src/index2.js');
const { buildGatewayStack } = await import('./cli/dist/cli/src/gateway-stack.js');

const logger = { info: (m) => console.log('[v2-create]', m) };
const address = '93da52ccf039b37fe7f5f0539d79d0dd328065267ccb6cfaae4413efe7385309';

const stack = await buildGatewayStack(logger, { version: 'v2', privateStateStoreName: 'veilpay2-control-state' });
try {
  const api = await VeilPay2API.join(stack.providers, address, logger);
  const coinPk = new Uint8Array(Buffer.from(String(stack.providers.walletProvider.getCoinPublicKey()).replace(/^0x/, ''), 'hex'));
  const id = await api.createIntent(2500n, 999999n, new Uint8Array(32), coinPk, globalThis.crypto.getRandomValues(new Uint8Array(32)));
  console.log('V2-CONTROL-CREATE-OK id=', id.toString());
} catch (error) {
  console.error('V2-CONTROL-CREATE-FAILED', error?.message ?? error);
} finally {
  await stack.close();
}
