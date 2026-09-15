import { Ledger } from "./managed/veilpay/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
export type VeilPayPrivateState = {
    readonly merchantSecretKey: Uint8Array;
    readonly paymentSecrets: Readonly<Record<string, Uint8Array>>;
};
export declare const createVeilPayPrivateState: (merchantSecretKey: Uint8Array, paymentSecrets?: Record<string, Uint8Array>) => VeilPayPrivateState;
export declare const withPaymentSecret: (state: VeilPayPrivateState, intentId: bigint, secret: Uint8Array) => VeilPayPrivateState;
export declare const witnesses: {
    merchantSecretKey: ({ privateState, }: WitnessContext<Ledger, VeilPayPrivateState>) => [VeilPayPrivateState, Uint8Array];
    paymentSecret: ({ privateState }: WitnessContext<Ledger, VeilPayPrivateState>, intentId: bigint) => [VeilPayPrivateState, Uint8Array];
};
