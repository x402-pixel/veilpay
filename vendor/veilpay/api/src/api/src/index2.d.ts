/**
 * VeilPay v2 API: private payment intents backed by REAL shielded token
 * transfers (NullPay parity). v1 (index.ts) stays as the oracle-only
 * generation; see docs/NULLPAY-V2-SPEC.md for the design.
 *
 * @packageDocumentation
 */
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import { type VeilPay2Providers, type DeployedVeilPay2Contract, type Intent2View } from './common-types.js';
import { type Observable } from 'rxjs';
/** A shielded coin ready to be spent in `pay` (zswap UTXO). */
export type SpendableCoin = {
    readonly nonce: Uint8Array;
    readonly color: Uint8Array;
    readonly value: bigint;
    readonly mtIndex: bigint;
};
/**
 * An API for a deployed VeilPay v2 contract.
 *
 * @remarks
 * Private state adds a long-lived `receiptSecret` (payer receipts) on top of
 * v1's merchant key + payment secrets. `pay` consumes a caller-supplied
 * shielded coin; obtaining and proving possession of coins is the wallet's
 * job (see docs/NULLPAY-V2-SPEC.md, Phase 2).
 */
export declare class VeilPay2API {
    readonly deployedContract: DeployedVeilPay2Contract;
    private readonly providers;
    private readonly logger?;
    private constructor();
    private merchantIdentityHex;
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<Intent2View[]>;
    /** Merchant creates a priced intent; `tokenColor` zero bytes = open intent. */
    createIntent(amount: bigint, expiresAt: bigint, tokenColor: Uint8Array, merchantCoinPk: Uint8Array, paymentSecret: Uint8Array): Promise<bigint>;
    /** Customer settles the intent AND moves real shielded value on-chain. */
    pay(intentId: bigint, paymentSecret: Uint8Array, coin: SpendableCoin): Promise<void>;
    /** Merchant records a refund against a paid intent. */
    refund(intentId: bigint, refundAmount: bigint): Promise<void>;
    /** Merchant cancels an unpaid intent. */
    cancel(intentId: bigint): Promise<void>;
    /** Public verification: was this intent settled? */
    isPaid(intentId: bigint): Promise<boolean>;
    /** Deploy a fresh v2 contract. */
    static deploy(providers: VeilPay2Providers, logger?: Logger): Promise<VeilPay2API>;
    /** Join an already-deployed v2 contract by address. */
    static join(providers: VeilPay2Providers, contractAddress: ContractAddress, logger?: Logger): Promise<VeilPay2API>;
    private static getPrivateState;
}
