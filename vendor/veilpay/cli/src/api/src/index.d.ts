/**
 * VeilPay API: deploy/join a payment-intent contract and drive it.
 *
 * @packageDocumentation
 */
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import { type VeilPayProviders, type DeployedVeilPayContract, type IntentView } from './common-types.js';
import { type Observable } from 'rxjs';
export * from './common-types.js';
/** Snapshot of every intent currently in the public ledger. */
export type LedgerSnapshot = {
    sequence: bigint;
    intents: IntentView[];
};
/**
 * An API for a deployed VeilPay contract.
 *
 * @remarks
 * Private state holds the merchant secret key plus any payment secrets the
 * local participant knows (merchants learn them when they create intents;
 * customers receive them out-of-band through checkout links).
 */
export declare class VeilPayAPI {
    readonly deployedContract: DeployedVeilPayContract;
    private readonly providers;
    private readonly logger?;
    private constructor();
    private merchantIdentityHex;
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<LedgerSnapshot['intents']>;
    /** Merchant creates a payment intent; returns the new id. */
    createIntent(amount: bigint, expiresAt: bigint, paymentSecret: Uint8Array): Promise<bigint>;
    /** Customer settles an intent. Requires knowledge of its payment secret. */
    pay(intentId: bigint, paymentSecret: Uint8Array): Promise<void>;
    /** Merchant refunds a paid intent (partial refunds not yet modeled). */
    refund(intentId: bigint, refundAmount: bigint): Promise<void>;
    /** Merchant cancels an unpaid intent. */
    cancel(intentId: bigint): Promise<void>;
    /** Public verification: was this intent settled? Reads ledger via indexer. */
    isPaid(intentId: bigint): Promise<boolean>;
    /** Deploy a fresh VeilPay contract. */
    static deploy(providers: VeilPayProviders, logger?: Logger): Promise<VeilPayAPI>;
    /** Join an already-deployed VeilPay contract by address. */
    static join(providers: VeilPayProviders, contractAddress: ContractAddress, logger?: Logger): Promise<VeilPayAPI>;
    private static getPrivateState;
}
