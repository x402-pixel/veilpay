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
import {
  type VeilPay3Providers,
  type Invoice3View,
  veilPay3PrivateStateKey,
} from './common-types.js';
import * as utils from './utils/index.js';
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import {
  type VeilPay3PrivateState,
  createVeilPay3PrivateState,
  withInvoiceOpening3,
} from '../../contract/src/witnesses3.js';

/** A shielded coin ready to be spent in a v3 settlement circuit (zswap UTXO). */
export type SpendableCoin = {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
  readonly mtIndex: bigint;
};

type VeilPay3ContractType = VeilPay3Generated.Contract<VeilPay3PrivateState>;
export type DeployedVeilPay3Contract = FoundContract<VeilPay3ContractType>;

export const CompiledVeilPay3ContractContract = CompiledContract.make<
  VeilPay3Generated.Contract<VeilPay3PrivateState>
>('VeilPay3', VeilPay3Generated.Contract<VeilPay3PrivateState>).pipe(
  CompiledContract.withWitnesses(witnesses3Module.witnesses3),
  CompiledContract.withCompiledFileAssets('./managed/veilpay3'),
);

export type InvoiceOpeningValue = witnesses3Module.InvoiceOpening;
export type InvoiceTypeName = 'standard' | 'multipay' | 'donation';

const INVOICE_TYPE_CODES = {
  standard: VeilPay3Generated.InvoiceType.STANDARD,
  multipay: VeilPay3Generated.InvoiceType.MULTI_PAY,
  donation: VeilPay3Generated.InvoiceType.DONATION,
} as const;

const INVOICE_TYPE_NAMES: InvoiceTypeName[] = ['standard', 'multipay', 'donation'];

export const invoiceTypeName = (code: number): InvoiceTypeName =>
  INVOICE_TYPE_NAMES[code] ?? 'standard';

const toQualified = (coin: SpendableCoin) => ({
  nonce: coin.nonce,
  color: coin.color,
  value: coin.value,
  mt_index: coin.mtIndex,
});

/**
 * An API for a deployed VeilPay v3 contract.
 *
 * @remarks
 * Private state holds the invoice openings the participant is allowed to see.
 * The merchant holds the openings for invoices it issued; the payer holds the
 * opening it decrypted from the checkout link. Only the commitment and the
 * lifecycle ever reach the public ledger.
 */
export class VeilPay3API {
  private constructor(
    public readonly deployedContract: DeployedVeilPay3Contract,
    private readonly providers: VeilPay3Providers,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    this.state$ = combineLatest(
      [
        providers.publicDataProvider
          .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
          .pipe(
            map((contractState) => VeilPay3Generated.ledger(contractState.data)),
            tap((ledgerState) => logger?.trace({ ledgerSequence: ledgerState.sequence.toString() })),
          ),
        from(providers.privateStateProvider.get(veilPay3PrivateStateKey) as Promise<VeilPay3PrivateState>),
      ],
      (l, privateState) => {
        const openings = privateState?.invoiceOpenings ?? {};
        return Object.keys(openings).map((key) => {
          const id = BigInt(key);
          const state = l.invoices.member(id) ? l.invoices.lookup(id) : null;
          return {
            invoiceId: key,
            opening: openings[key],
            status: state ? Number(state.status) : null,
            expiresAt: state ? state.expiresAt : 0n,
            hasReceipt: l.receipts.member(id),
          } satisfies Invoice3View;
        });
      },
    );
  }

  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<Invoice3View[]>;

  private async privateState(): Promise<VeilPay3PrivateState> {
    const existing = (await this.providers.privateStateProvider.get(
      veilPay3PrivateStateKey,
    )) as VeilPay3PrivateState | undefined;
    return existing ?? createVeilPay3PrivateState(utils.randomBytes(32), utils.randomBytes(32));
  }

  /** Read the current ledger sequence; the next invoice id is sequence + 1. */
  async nextInvoiceId(): Promise<bigint> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.deployedContractAddress,
    );
    if (!state) return 1n;
    return VeilPay3Generated.ledger(state.data).sequence + 1n;
  }

  /** Stage an invoice opening in local private state (never leaves the device). */
  async stageOpening(invoiceId: bigint | string, opening: InvoiceOpeningValue): Promise<void> {
    const state = await this.privateState();
    await this.providers.privateStateProvider.set(
      veilPay3PrivateStateKey,
      withInvoiceOpening3(state, invoiceId, opening),
    );
  }

  /** Build an opening locally from plain invoice terms. */
  buildOpening(args: {
    amount: bigint;
    tokenColor: Uint8Array;
    merchantCoinPk: Uint8Array;
    invoiceType: InvoiceTypeName;
    paymentSecret?: Uint8Array;
    salt?: Uint8Array;
  }): { opening: InvoiceOpeningValue; paymentSecret: Uint8Array; salt: Uint8Array } {
    const paymentSecret = args.paymentSecret ?? utils.randomBytes(32);
    const salt = args.salt ?? utils.randomBytes(32);
    return {
      opening: {
        amount: args.amount,
        tokenColor: args.tokenColor,
        merchantCoinPk: args.merchantCoinPk,
        invoiceType: INVOICE_TYPE_CODES[args.invoiceType],
        paymentSecret,
        salt,
      },
      paymentSecret,
      salt,
    };
  }

  /** Merchant issues a private invoice; only the commitment reaches the ledger. */
  async issueInvoice(args: {
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
  }> {
    const { opening, paymentSecret, salt } = this.buildOpening(args);
    const nextId = await this.nextInvoiceId();
    await this.stageOpening(nextId, opening);
    this.logger?.info(`issuing v3 invoice #${nextId}`);

    const txData = await this.deployedContract.callTx.issueInvoice(
      opening.amount,
      opening.tokenColor,
      opening.merchantCoinPk,
      INVOICE_TYPE_CODES[args.invoiceType],
      args.expiresAt,
    );
    const invoiceId = (txData.private.result as bigint) ?? nextId;

    return {
      invoiceId: invoiceId.toString(),
      paymentSecret: toHex(paymentSecret),
      salt: toHex(salt),
      merchantCoinPk: toHex(opening.merchantCoinPk),
      tokenColor: toHex(opening.tokenColor),
      expiresAt: args.expiresAt.toString(),
      invoiceType: args.invoiceType,
    };
  }

  /** Payer settles a standard invoice and moves shielded value atomically. */
  async settleStandard(invoiceId: bigint, opening: InvoiceOpeningValue, coin: SpendableCoin): Promise<void> {
    await this.stageOpening(invoiceId, opening);
    await this.deployedContract.callTx.settleStandard(invoiceId, toQualified(coin));
  }

  /** Payer contributes to a Multi Pay campaign; the invoice stays open. */
  async settleMultiPayment(
    invoiceId: bigint,
    opening: InvoiceOpeningValue,
    coin: SpendableCoin,
  ): Promise<void> {
    await this.stageOpening(invoiceId, opening);
    await this.deployedContract.callTx.settleMultiPayment(invoiceId, toQualified(coin));
  }

  /** Payer donates a chosen amount; change returns to the payer. */
  async acceptDonation(
    invoiceId: bigint,
    opening: InvoiceOpeningValue,
    coin: SpendableCoin,
    amount: bigint,
  ): Promise<void> {
    await this.stageOpening(invoiceId, opening);
    await this.deployedContract.callTx.acceptDonation(invoiceId, toQualified(coin), amount);
  }

  /** Merchant closes a Multi Pay campaign. */
  async settleMulti(invoiceId: bigint): Promise<void> {
    this.logger?.info(`settling v3 multi-pay invoice #${invoiceId}`);
    await this.deployedContract.callTx.settleMulti(invoiceId);
  }

  /** Merchant cancels an unpaid invoice. */
  async cancelInvoice(invoiceId: bigint): Promise<void> {
    this.logger?.info(`cancelling v3 invoice #${invoiceId}`);
    await this.deployedContract.callTx.cancelInvoice(invoiceId);
  }

  /** Public verification: is this invoice settled (paid or closed)? */
  async isSettled(invoiceId: bigint): Promise<boolean> {
    const contractState = await this.providers.publicDataProvider.queryContractState(
      this.deployedContractAddress,
    );
    if (!contractState) return false;
    const l = VeilPay3Generated.ledger(contractState.data);
    if (!l.invoices.member(invoiceId)) return false;
    const status = l.invoices.lookup(invoiceId).status;
    return (
      status === VeilPay3Generated.InvoiceStatus.PAID ||
      status === VeilPay3Generated.InvoiceStatus.SETTLED
    );
  }

  /** Deploy a fresh v3 contract. */
  static async deploy(providers: VeilPay3Providers, logger?: Logger): Promise<VeilPay3API> {
    logger?.info('deployContract v3');
    const deployed = (await deployContract(
      providers as never,
      {
        compiledContract: CompiledVeilPay3ContractContract,
        privateStateId: veilPay3PrivateStateKey,
        initialPrivateState: createVeilPay3PrivateState(utils.randomBytes(32), utils.randomBytes(32)),
      } as never,
    )) as unknown as DeployedVeilPay3Contract;
    return new VeilPay3API(deployed, providers, logger);
  }

  /** Join an already-deployed v3 contract by address. */
  static async join(
    providers: VeilPay3Providers,
    contractAddress: ContractAddress,
    logger?: Logger,
  ): Promise<VeilPay3API> {
    logger?.info({ joinContract: { contractAddress } });
    const deployed = await findDeployedContract<VeilPay3ContractType>(providers, {
      contractAddress,
      compiledContract: CompiledVeilPay3ContractContract,
      privateStateId: veilPay3PrivateStateKey,
      initialPrivateState: await VeilPay3API.getPrivateState(providers, contractAddress),
    });
    return new VeilPay3API(deployed, providers, logger);
  }

  private static async getPrivateState(
    providers: VeilPay3Providers,
    contractAddress: ContractAddress,
  ): Promise<VeilPay3PrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = (await providers.privateStateProvider.get(
      veilPay3PrivateStateKey,
    )) as VeilPay3PrivateState | undefined;
    return existing ?? createVeilPay3PrivateState(utils.randomBytes(32), utils.randomBytes(32));
  }
}
