/*
 * Deploy VeilPay v3 (private invoices, atomic shielded settlement) through the
 * sponsored 1AM gateway, same no-faucet/no-sync path as v1 and v2.
 * See docs/DEPLOYMENT.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { VeilPay3API } from '../../api/src/index3.js';
import { createLogger } from './logger-utils.js';
import { buildGatewayStack, ADDRESS_FILE_V3, STATE_DIR } from './gateway-stack.js';
const runGatewayDeploy3 = async () => {
    const logger = await createLogger(path.resolve(STATE_DIR, '..', 'logs', 'preprod', `gateway3-${new Date().toISOString().slice(0, 10)}.log`));
    logger.info('deploying VeilPay v3 through the sponsored gateway');
    const { providers, session, close } = await buildGatewayStack(logger, { version: 'v3' });
    try {
        const api = await VeilPay3API.deploy(providers, logger);
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(ADDRESS_FILE_V3, api.deployedContractAddress);
        logger.info(`Deployed VeilPay v3 at ${api.deployedContractAddress}`);
        console.log(JSON.stringify({
            contractAddress: api.deployedContractAddress,
            deployerAddress: session.address,
            network: 'preprod',
            version: 'v3-private',
            path: 'gateway-sponsored',
        }, null, 2));
    }
    finally {
        await close();
    }
};
await runGatewayDeploy3();
//# sourceMappingURL=gateway-deploy3.js.map