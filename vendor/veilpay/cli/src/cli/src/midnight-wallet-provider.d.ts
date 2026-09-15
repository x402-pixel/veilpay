import { type CoinPublicKey, DustSecretKey, type EncPublicKey, type FinalizedTransaction, ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type MidnightProvider, type UnboundTransaction, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { Logger } from 'pino';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
type UnshieldedKeystore = {
    getPublicKey(): unknown;
    signData(payload: Uint8Array): string;
};
/**
 * Provider class that implements wallet functionality for the Midnight network.
 * Handles transaction balancing, submission, and wallet state management.
 */
export declare class MidnightWalletProvider implements MidnightProvider, WalletProvider {
    logger: Logger;
    readonly env: EnvironmentConfiguration;
    readonly wallet: WalletFacade;
    readonly unshieldedKeystore: UnshieldedKeystore;
    readonly zswapSecretKeys: ZswapSecretKeys;
    readonly dustSecretKey: DustSecretKey;
    private constructor();
    getCoinPublicKey(): CoinPublicKey;
    getEncryptionPublicKey(): EncPublicKey;
    balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction>;
    submitTx(tx: FinalizedTransaction): Promise<string>;
    start(): Promise<void>;
    stop(): Promise<void>;
    static build(logger: Logger, env: EnvironmentConfiguration, seed?: string): Promise<MidnightWalletProvider>;
}
export {};
