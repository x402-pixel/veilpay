import {
  type CircuitContext,
  CostModel,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  InvoiceType,
  type InvoiceOpening,
  type Ledger,
  ledger,
} from "../managed/veilpay3/contract/index.js";
import {
  type VeilPay3PrivateState,
  createVeilPay3PrivateState,
  withInvoiceOpening3,
  witnesses3,
} from "../witnesses3.js";

/*
 * In-memory testbed for the v3 (private invoice) contract.
 *
 * Coins are consumed locally the way the official Midnight token-transfers
 * example tests do it: a ShieldedCoinInfo is constructed by hand and
 * "qualified" with an mt_index, which is sufficient for circuit execution.
 */

export type EncodedCoinInfo = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
};

export type EncodedQualifiedCoin = EncodedCoinInfo & { mt_index: bigint };

export type EncodedSendResult = {
  sent: EncodedCoinInfo;
  change: { is_some: boolean; value?: EncodedCoinInfo };
};

export const qualifiedCoin = (
  value: bigint,
  color: Uint8Array,
  nonce: Uint8Array,
  mtIndex = 0n,
): EncodedQualifiedCoin => ({ nonce, color, value, mt_index: mtIndex });

const invoiceTypeCode = (value: "standard" | "multipay" | "donation"): InvoiceType =>
  value === "standard"
    ? InvoiceType.STANDARD
    : value === "multipay"
      ? InvoiceType.MULTI_PAY
      : InvoiceType.DONATION;

export type OpeningArgs = {
  amount: bigint;
  tokenColor: Uint8Array;
  merchantCoinPk: Uint8Array;
  invoiceType: "standard" | "multipay" | "donation";
  paymentSecret: Uint8Array;
  salt: Uint8Array;
};

export class VeilPay3Simulator {
  readonly contract: Contract<VeilPay3PrivateState>;
  circuitContext: CircuitContext<VeilPay3PrivateState>;

  constructor(privateState: VeilPay3PrivateState) {
    this.contract = new Contract<VeilPay3PrivateState>(witnesses3);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext(privateState, "0".repeat(64)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  static deploy(merchantSecretKey: Uint8Array, receiptSecret: Uint8Array): VeilPay3Simulator {
    return new VeilPay3Simulator(createVeilPay3PrivateState(merchantSecretKey, receiptSecret));
  }

  setPayerCoinPublicKey(pk: Uint8Array): void {
    this.circuitContext.currentZswapLocalState = {
      ...this.circuitContext.currentZswapLocalState,
      coinPublicKey: { bytes: pk },
    };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  getPrivateState(): VeilPay3PrivateState {
    return this.circuitContext.currentPrivateState;
  }

  setPrivateState(state: VeilPay3PrivateState): void {
    this.circuitContext.currentPrivateState = state;
  }

  buildOpening(args: OpeningArgs): InvoiceOpening {
    return {
      amount: args.amount,
      tokenColor: args.tokenColor,
      merchantCoinPk: args.merchantCoinPk,
      invoiceType: invoiceTypeCode(args.invoiceType),
      paymentSecret: args.paymentSecret,
      salt: args.salt,
    };
  }

  /** Stage the opening for the next invoice id and issue it on the ledger. */
  issueInvoice(
    args: OpeningArgs & { expiresAt: bigint },
  ): { ledger: Ledger; invoiceId: bigint; opening: InvoiceOpening } {
    const nextId = this.getLedger().sequence + 1n;
    const opening = this.buildOpening(args);
    this.circuitContext.currentPrivateState = withInvoiceOpening3(
      this.circuitContext.currentPrivateState,
      nextId,
      opening,
    );
    const { context, result } = this.contract.impureCircuits.issueInvoice(
      this.circuitContext,
      args.amount,
      args.tokenColor,
      args.merchantCoinPk,
      invoiceTypeCode(args.invoiceType),
      args.expiresAt,
    );
    this.circuitContext = context;
    return {
      ledger: ledger(this.circuitContext.currentQueryContext.state),
      invoiceId: result as bigint,
      opening,
    };
  }

  settleStandard(invoiceId: bigint, coin: EncodedQualifiedCoin): EncodedSendResult {
    const { context, result } = this.contract.impureCircuits.settleStandard(
      this.circuitContext,
      invoiceId,
      coin as never,
    );
    this.circuitContext = context;
    return result as unknown as EncodedSendResult;
  }

  settleMultiPayment(invoiceId: bigint, coin: EncodedQualifiedCoin): EncodedSendResult {
    const { context, result } = this.contract.impureCircuits.settleMultiPayment(
      this.circuitContext,
      invoiceId,
      coin as never,
    );
    this.circuitContext = context;
    return result as unknown as EncodedSendResult;
  }

  acceptDonation(invoiceId: bigint, coin: EncodedQualifiedCoin, amount: bigint): EncodedSendResult {
    const { context, result } = this.contract.impureCircuits.acceptDonation(
      this.circuitContext,
      invoiceId,
      coin as never,
      amount,
    );
    this.circuitContext = context;
    return result as unknown as EncodedSendResult;
  }

  settleMulti(invoiceId: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.settleMulti(this.circuitContext, invoiceId)
      .context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  cancelInvoice(invoiceId: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.cancelInvoice(
      this.circuitContext,
      invoiceId,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}
