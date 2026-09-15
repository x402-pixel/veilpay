import { Ledger } from "./managed/veilpay2/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
export type VeilPay2PrivateState = {
    readonly merchantSecretKey: Uint8Array;
    readonly paymentSecrets: Readonly<Record<string, Uint8Array>>;
    readonly receiptSecret: Uint8Array;
};
export declare const createVeilPay2PrivateState: (merchantSecretKey: Uint8Array, receiptSecret: Uint8Array, paymentSecrets?: Record<string, Uint8Array>) => VeilPay2PrivateState;
export declare const withPaymentSecret2: (state: VeilPay2PrivateState, intentId: bigint, secret: Uint8Array) => VeilPay2PrivateState;
export declare const witnesses2: {
    merchantSecretKey: ({ privateState, }: WitnessContext<Ledger, VeilPay2PrivateState>) => [VeilPay2PrivateState, Uint8Array];
    paymentSecret: ({ privateState }: WitnessContext<Ledger, VeilPay2PrivateState>, intentId: bigint) => [VeilPay2PrivateState, Uint8Array];
    receiptSecret: ({ privateState, }: WitnessContext<Ledger, VeilPay2PrivateState>) => [VeilPay2PrivateState, Uint8Array];
};
