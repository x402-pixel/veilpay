import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Logger } from 'pino';
export declare const getUnshieldedSeed: (seed: string) => Uint8Array<ArrayBufferLike>;
export declare const generateDust: (logger: Logger, walletSeed: string, unshieldedState: UnshieldedWalletState, walletFacade: WalletFacade) => Promise<any>;
