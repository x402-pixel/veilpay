// Control experiment: deploy the known-good v2 contract with the same seed,
// gateway stack and toolchain used for the v3 attempt, to isolate whether
// "Custom error: 182" comes from the v3 contract or from the environment.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await realFetch(url, { ...options, signal: undefined });
    } catch (error) {
      lastError = error;
      console.error(`[retry] ${String(url).slice(0, 50)} failed (${attempt}/8)`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
};

const { CompiledContract } = await import('@midnight-ntwrk/midnight-js-protocol/compact-js');
const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
const { buildGatewayStack } = await import('./cli/dist/cli/src/gateway-stack.js');
const Contract2 = await import('./cli/dist/contract/src/managed/veilpay2/contract/index.js');
const Witnesses2 = await import('./cli/dist/contract/src/witnesses2.js');

const logger = { info: (m) => console.log('[v2-control]', m) };

const compiled = CompiledContract.make('VeilPay2', Contract2.Contract).pipe(
  CompiledContract.withWitnesses(Witnesses2.witnesses2),
  CompiledContract.withCompiledFileAssets('./cli/dist/contract/src/managed/veilpay2'),
);

const { providers, close } = await buildGatewayStack(logger, { version: 'v2' });
try {
  const deployed = await deployContract(providers, {
    compiledContract: compiled,
    privateStateId: 'veilpay2PrivateState',
    initialPrivateState: Witnesses2.createVeilPay2PrivateState(
      globalThis.crypto.getRandomValues(new Uint8Array(32)),
      globalThis.crypto.getRandomValues(new Uint8Array(32)),
    ),
  });
  console.log('V2-CONTROL-DEPLOYED', deployed.deployTxData.public.contractAddress);
} catch (error) {
  console.error('V2-CONTROL-FAILED', error);
} finally {
  await close();
}
