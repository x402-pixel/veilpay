// Local deploy wrapper: retries transient network failures (the 1AM gateway
// and GitHub have been timing out intermittently on this machine).
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, options = {}) => {
  const attempts = 8;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await realFetch(url, { ...options, signal: undefined });
    } catch (error) {
      lastError = error;
      const wait = 2000 * attempt;
      console.error(`[retry] fetch ${String(url).slice(0, 60)} failed (${attempt}/${attempts}): ${error?.message ?? error}; retrying in ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
};

await import('./cli/dist/cli/src/gateway-deploy3.js');
