import { type PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { type VeilPayProviders } from '../../api/src/common-types.js';
import { type VeilPay2Providers } from '../../api/src/common-types.js';
import { type VeilPay3Providers } from '../../api/src/common-types.js';
export declare const STATE_DIR: string;
export declare const SESSION_FILE: string;
export declare const ADDRESS_FILE: string;
export declare const GATEWAY = "https://api-preprod.1am.xyz";
export declare const EXPLORER = "https://preprod.midnightexplorer.com";
/** Which compiled contract a stack/provision is built for. */
export type ContractVersion = 'v1' | 'v2' | 'v3';
export declare const ADDRESS_FILE_V2: string;
export declare const ADDRESS_FILE_V3: string;
type Logger = {
    info: (m: string) => void;
    warn?: (m: string) => void;
};
export interface GatewaySession {
    token: string;
    address: string;
    expires_in: number;
}
export declare const loadSeed: () => string;
/**
 * Authenticate against the gateway with a BIP-340 Schnorr signature over the
 * challenge message, using the same NightExternal key the wallet SDK derives
 * from our seed. Session tokens are long-lived; cache and reuse.
 */
export declare function gatewaySession(seed: string, logger: Logger): Promise<GatewaySession>;
/**
 * Wrap the SDK indexer provider, replacing the two inclusion watches with
 * HTTP polling that works through the gateway:
 *
 *  - watchForTxData: the SDK polls by Midnight *identifier*, which never
 *    matches the *extrinsic* hash our submitTx returns. We poll by the tx
 *    *hash* the gateway reported from /balance-only instead (FIFO-ordered:
 *    balance -> submit -> watch is strictly sequential in midnight-js).
 *  - watchForDeployTxData: polls contractAction(address) directly, which the
 *    gateway indexer answers fine. NOTE: contractAction returns the *latest*
 *    action for the address, which becomes a ContractCall once any intent has
 *    been created; we follow its `deploy` edge, and callers can also pass the
 *    known deploy-tx hash explicitly to skip address lookup entirely.
 */
export declare function withPollingWatches(base: PublicDataProvider, session: GatewaySession, pendingMidnightHashes: string[], logger: Logger, deployTxHash?: string): PublicDataProvider;
export interface GatewayStack {
    providers: VeilPayProviders;
    session: GatewaySession;
    close: () => Promise<void>;
}
export interface GatewayStack2 {
    providers: VeilPay2Providers;
    session: GatewaySession;
    close: () => Promise<void>;
}
export interface GatewayStack3 {
    providers: VeilPay3Providers;
    session: GatewaySession;
    close: () => Promise<void>;
}
/**
 * Build the full VeilPay provider stack over the gateway: hosted proving,
 * sponsored balancing, RPC submission, relayed indexer queries, and the
 * polling inclusion watches described above.
 */
export declare function buildGatewayStack(logger: Logger, opts?: {
    version?: ContractVersion;
    privateStateStoreName?: string;
    /**
     * Known deploy transaction hash (hex, 0x optional). When set, the join
     * inclusion watch polls the indexer by hash instead of by contract
     * address, which sidesteps the gateway's latest-action-per-address
     * ambiguity (verified live 2026-09-14).
     */
    deployTxHash?: string;
}): Promise<GatewayStack & GatewayStack2 & GatewayStack3>;
export {};
