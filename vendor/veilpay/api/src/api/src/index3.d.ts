/**
 * VeilPay v3 API: private invoices with atomic shielded settlement.
 *
 * v2 (index2.ts) keeps the amount, token color, and merchant coin key in
 * public ledger state. v3 stores only the invoice commitment and lifecycle
 * metadata publicly; amount, token color, recipient coin key, invoice type,
 * payment secret and salt travel through private witnesses.
 *
 * @packageDocumentation
 */
import * as VeilPay3Generated from '../../contract/src/managed/veilpay3/contract/index.js';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as witnesses3Module from '../../contract/src/witnesses3.js';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import { type VeilPay3Providers, type Invoice3View } from './common-types.js';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Observable } from 'rxjs';
import { type VeilPay3PrivateState } from '../../contract/src/witnesses3.js';
/** A shielded coin ready to be spent in a v3 settlement circuit (zswap UTXO). */
export type SpendableCoin = {
    readonly nonce: Uint8Array;
    readonly color: Uint8Array;
    readonly value: bigint;
    readonly mtIndex: bigint;
};
type VeilPay3ContractType = VeilPay3Generated.Contract<VeilPay3PrivateState>;
export type DeployedVeilPay3Contract = FoundContract<VeilPay3ContractType>;
export declare const CompiledVeilPay3ContractContract: CompiledContract.CompiledContract<VeilPay3Generated.Contract<witnesses3Module.VeilPay3PrivateState, VeilPay3Generated.Witnesses<witnesses3Module.VeilPay3PrivateState>>, witnesses3Module.VeilPay3PrivateState, never>;
export type InvoiceOpeningValue = witnesses3Module.InvoiceOpening;
export type InvoiceTypeName = 'standard' | 'multipay' | 'donation';
export declare const invoiceTypeName: (code: number) => InvoiceTypeName;
/**
 * An API for a deployed VeilPay v3 contract.
 *
 * @remarks
 * Private state holds the invoice openings the participant is allowed to see.
 * The merchant holds the openings for invoices it issued; the payer holds the
 * opening it decrypted from the checkout link. Only the commitment and the
 * lifecycle ever reach the public ledger.
 */
export declare class VeilPay3API {
    readonly deployedContract: DeployedVeilPay3Contract;
    private readonly providers;
    private readonly logger?;
    private constructor();
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<Invoice3View[]>;
    private privateState;
    /** Read the current ledger sequence; the next invoice id is sequence + 1. */
    nextInvoiceId(): Promise<bigint>;
    /** Stage an invoice opening in local private state (never leaves the device). */
    stageOpening(invoiceId: bigint | string, opening: InvoiceOpeningValue): Promise<void>;
    /** Build an opening locally from plain invoice terms. */
    buildOpening(args: {
        amount: bigint;
        tokenColor: Uint8Array;
        merchantCoinPk: Uint8Array;
        invoiceType: InvoiceTypeName;
        paymentSecret?: Uint8Array;
        salt?: Uint8Array;
    }): {
        opening: InvoiceOpeningValue;
        paymentSecret: Uint8Array;
        salt: Uint8Array;
    };
    /** Merchant issues a private invoice; only the commitment reaches the ledger. */
    issueInvoice(args: {
        amount: bigint;
        tokenColor: Uint8Array;
        merchantCoinPk: Uint8Array;
        invoiceType: InvoiceTypeName;
        expiresAt: bigint;
        paymentSecret?: Uint8Array;
        salt?: Uint8Array;
    }): Promise<{
        invoiceId: string;
        paymentSecret: string;
        salt: string;
        merchantCoinPk: string;
        tokenColor: string;
        expiresAt: string;
        invoiceType: InvoiceTypeName;
    }>;
    /** Payer settles a standard invoice and moves shielded value atomically. */
    settleStandard(invoiceId: bigint, opening: InvoiceOpeningValue, coin: SpendableCoin): Promise<void>;
    /** Payer contributes to a Multi Pay campaign; the invoice stays open. */
    settleMultiPayment(invoiceId: bigint, opening: InvoiceOpeningValue, coin: SpendableCoin): Promise<void>;
    /** Payer donates a chosen amount; change returns to the payer. */
    acceptDonation(invoiceId: bigint, opening: InvoiceOpeningValue, coin: SpendableCoin, amount: bigint): Promise<void>;
    /** Merchant closes a Multi Pay campaign. */
    settleMulti(invoiceId: bigint): Promise<void>;
    /** Merchant cancels an unpaid invoice. */
    cancelInvoice(invoiceId: bigint): Promise<void>;
    /** Public verification: is this invoice settled (paid or closed)? */
    isSettled(invoiceId: bigint): Promise<boolean>;
    /** Deploy a fresh v3 contract. */
    static deploy(providers: VeilPay3Providers, logger?: Logger): Promise<VeilPay3API>;
    /** Join an already-deployed v3 contract by address. */
    static join(providers: VeilPay3Providers, contractAddress: ContractAddress, logger?: Logger): Promise<VeilPay3API>;
    private static getPrivateState;
}
export {};
