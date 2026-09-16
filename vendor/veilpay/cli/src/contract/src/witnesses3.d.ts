import { type InvoiceOpening as GeneratedOpening, type Ledger } from "./managed/veilpay3/contract/index.js";
import { type WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
export type InvoiceOpening = {
    readonly amount: bigint;
    readonly tokenColor: Uint8Array;
    readonly merchantCoinPk: Uint8Array;
    readonly invoiceType: number;
    readonly paymentSecret: Uint8Array;
    readonly salt: Uint8Array;
};
export type VeilPay3PrivateState = {
    readonly merchantSecretKey: Uint8Array;
    readonly receiptSecret: Uint8Array;
    readonly invoiceOpenings: Readonly<Record<string, GeneratedOpening>>;
};
export declare const createVeilPay3PrivateState: (merchantSecretKey: Uint8Array, receiptSecret: Uint8Array, invoiceOpenings?: Record<string, GeneratedOpening>) => VeilPay3PrivateState;
export declare const withInvoiceOpening3: (state: VeilPay3PrivateState, invoiceId: bigint | string, opening: InvoiceOpening) => VeilPay3PrivateState;
export declare const witnesses3: {
    merchantSecretKey: ({ privateState, }: WitnessContext<Ledger, VeilPay3PrivateState>) => [VeilPay3PrivateState, Uint8Array];
    receiptSecret: ({ privateState, }: WitnessContext<Ledger, VeilPay3PrivateState>) => [VeilPay3PrivateState, Uint8Array];
    invoiceOpening: ({ privateState }: WitnessContext<Ledger, VeilPay3PrivateState>, invoiceId: bigint) => [VeilPay3PrivateState, GeneratedOpening];
};
