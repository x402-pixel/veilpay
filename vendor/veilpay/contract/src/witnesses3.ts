import { type InvoiceOpening as GeneratedOpening, type Ledger } from "./managed/veilpay3/contract/index.js";
import { type WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

/*
 * Structural mirror of the generated `InvoiceOpening` struct. Keeping it local
 * (instead of importing managed/veilpay3) lets the host build run before the
 * pinned Compact 0.31.1 compiler emits the module in CI or a Linux/Docker env.
 */
export type InvoiceOpening = {
  readonly amount: bigint;
  readonly tokenColor: Uint8Array;
  readonly merchantCoinPk: Uint8Array;
  readonly invoiceType: number;
  readonly paymentSecret: Uint8Array;
  readonly salt: Uint8Array;
};

/*
 * Private state for a VeilPay v3 participant.
 *
 * The invoice opening never touches public ledger state: the contract stores
 * only its commitment. `invoiceOpenings` maps invoice id -> opening so the
 * merchant can issue and the payer can settle without revealing amount, token
 * color, recipient coin key, invoice type, or the payment secret.
 */
export type VeilPay3PrivateState = {
  readonly merchantSecretKey: Uint8Array;
  readonly receiptSecret: Uint8Array;
  readonly invoiceOpenings: Readonly<Record<string, GeneratedOpening>>;
};

export const createVeilPay3PrivateState = (
  merchantSecretKey: Uint8Array,
  receiptSecret: Uint8Array,
  invoiceOpenings: Record<string, GeneratedOpening> = {},
): VeilPay3PrivateState => ({ merchantSecretKey, receiptSecret, invoiceOpenings });

export const withInvoiceOpening3 = (
  state: VeilPay3PrivateState,
  invoiceId: bigint | string,
  opening: InvoiceOpening,
): VeilPay3PrivateState => ({
  ...state,
  invoiceOpenings: { ...state.invoiceOpenings, [invoiceId.toString()]: opening },
});

export const witnesses3 = {
  merchantSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, VeilPay3PrivateState>): [VeilPay3PrivateState, Uint8Array] => [
    privateState,
    privateState.merchantSecretKey,
  ],

  receiptSecret: ({
    privateState,
  }: WitnessContext<Ledger, VeilPay3PrivateState>): [VeilPay3PrivateState, Uint8Array] => [
    privateState,
    privateState.receiptSecret,
  ],

  invoiceOpening: (
    { privateState }: WitnessContext<Ledger, VeilPay3PrivateState>,
    invoiceId: bigint,
  ): [VeilPay3PrivateState, GeneratedOpening] => {
    const opening = privateState.invoiceOpenings[invoiceId.toString()];
    if (opening === undefined) {
      throw new Error(`No invoice opening known for invoice ${invoiceId}`);
    }
    return [privateState, opening];
  },
};
