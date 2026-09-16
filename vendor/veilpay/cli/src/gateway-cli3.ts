/*
 * VeilPay v3 lifecycle driver: private invoices with atomic shielded
 * settlement, against the contract deployed on Midnight Preprod through the
 * sponsored 1AM gateway (no faucet, no wallet sync, no local proofs).
 *
 * Commands:
 *   issue <amount> [ttlOps] [type] [tokenColorHex]
 *                                              merchant invoice; prints id + secret
 *                                              type: standard (default) | multipay | donation
 *   pay <invoiceId> <secretHex> <value> [colorHex] [nonceHex] [mtIndex]
 *                                              settle AND move value on-chain
 *   settle <invoiceId>                         merchant closes a Multi Pay campaign
 *   cancel <invoiceId>                         merchant cancels an unpaid invoice
 *   status [invoiceId]                         ledger summary or one invoice
 *
 * Usage:
 *   npm --workspace cli run preprod-gateway3      # deploy v3
 *   npm --workspace cli run preprod-tx3 -- issue 2500 50
 */

import fs from 'node:fs';
import path from 'node:path';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { VeilPay3API, type SpendableCoin } from '../../api/src/index3.js';
import {
  ledger,
  type InvoiceOpening,
  type InvoiceState,
  type Ledger,
} from '../../contract/src/managed/veilpay3/contract/index.js';
import { randomBytes } from '../../api/src/utils/index.js';
import { createLogger } from './logger-utils.js';
import { buildGatewayStack, ADDRESS_FILE_V3, STATE_DIR, EXPLORER } from './gateway-stack.js';

const deployedAddress = (): string | null => {
  const envAddr = process.env.VEILPAY_V3_CONTRACT_ADDRESS ?? process.env.VEILPAY_CONTRACT_ADDRESS;
  if (envAddr) return envAddr.trim();
  if (fs.existsSync(ADDRESS_FILE_V3)) return fs.readFileSync(ADDRESS_FILE_V3, 'utf8').trim();
  return null;
};

const STATUS_NAMES = ['ACTIVE', 'PAID', 'SETTLED', 'CANCELLED'] as const;
const TYPE_NAMES = ['standard', 'multipay', 'donation'] as const;

const unhex32 = (s: string, label: string): Uint8Array => {
  const b = new Uint8Array(Buffer.from(s.replace(/^0x/, ''), 'hex'));
  if (b.length !== 32) throw new Error(`${label} must be 32 bytes of hex`);
  return b;
};

const hexToBytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s.replace(/^0x/, ''), 'hex'));

const invoiceJson = (invoiceId: bigint, state: InvoiceState): string =>
  JSON.stringify(
    {
      invoiceId: invoiceId.toString(),
      commitment: toHex(state.commitment),
      merchantAuth: toHex(state.merchantAuth),
      invoiceType: TYPE_NAMES[Number(state.invoiceType)] ?? String(state.invoiceType),
      status: STATUS_NAMES[Number(state.status)] ?? String(state.status),
      expiresAt: state.expiresAt.toString(),
    },
    null,
    2,
  );

const run = async (argv: string[]): Promise<void> => {
  const [command, ...rest] = argv;
  if (!command) {
    console.error('usage: preprod-tx3 <issue|pay|settle|cancel|status> [args]');
    process.exitCode = 1;
    return;
  }

  const logger = await createLogger(
    path.resolve(STATE_DIR, '..', 'logs', 'preprod', `gateway3-tx-${new Date().toISOString().slice(0, 10)}.log`),
  );

  const address = deployedAddress();
  if (!address) {
    logger.error('no v3 contract recorded; run `preprod-gateway3` first');
    process.exitCode = 1;
    return;
  }

  const stack = await buildGatewayStack(logger, {
    version: 'v3',
    privateStateStoreName: 'veilpay3-private-state',
  });
  const providers = stack.providers;

  try {
    logger.info(`joining VeilPay v3 at ${address}`);
    const api = await VeilPay3API.join(providers, address, logger);

    const readLedger = async (): Promise<Ledger> => {
      const state = await providers.publicDataProvider.queryContractState(address);
      if (!state) throw new Error(`no contract state at ${address}`);
      return ledger(state.data);
    };

    switch (command) {
      case 'issue': {
        const amount = BigInt(rest[0] ?? '1000');
        const ttlOps = BigInt(rest[1] ?? '1000');
        const invoiceType = (rest[2] ?? 'standard') as 'standard' | 'multipay' | 'donation';
        if (!TYPE_NAMES.includes(invoiceType)) throw new Error(`unknown invoice type: ${invoiceType}`);
        const tokenColor = rest[3] ? unhex32(rest[3], 'tokenColor') : new Uint8Array(32);
        const merchantCoinPk = hexToBytes(String(providers.walletProvider.getCoinPublicKey()));
        if (merchantCoinPk.length !== 32) throw new Error('unexpected coin public key length');
        const current = await readLedger();
        const expiresAt = current.sequence + ttlOps;
        const issued = await api.issueInvoice({
          amount: invoiceType === 'donation' ? 0n : amount,
          tokenColor,
          merchantCoinPk,
          invoiceType,
          expiresAt,
        });
        console.log(
          JSON.stringify({ ...issued, explorer: `${EXPLORER}/contracts/0x${address}` }, null, 2),
        );
        break;
      }
      case 'pay': {
        const invoiceId = BigInt(rest[0] ?? '');
        const secretHex = rest[1] ?? process.env.VEILPAY_PAYMENT_SECRET;
        const value = BigInt(rest[2] ?? '0');
        if (!secretHex || !value) {
          logger.error('usage: pay <invoiceId> <secretHex> <value> [colorHex] [nonceHex] [mtIndex]');
          process.exitCode = 1;
          break;
        }
        const state = (await providers.privateStateProvider.get('veilPay3PrivateState')) as
          | { invoiceOpenings?: Record<string, InvoiceOpening> }
          | undefined;
        const opening = state?.invoiceOpenings?.[invoiceId.toString()];
        if (!opening) {
          logger.error(`no local opening for invoice ${invoiceId}; run issue in this workspace first`);
          process.exitCode = 1;
          break;
        }
        const paymentSecret = unhex32(secretHex, 'paymentSecret');
        if (toHex(paymentSecret) !== toHex(opening.paymentSecret)) {
          logger.error('payment secret does not match the stored invoice opening');
          process.exitCode = 1;
          break;
        }
        const coin: SpendableCoin = {
          value,
          color: rest[3] ? unhex32(rest[3], 'color') : new Uint8Array(32),
          nonce: rest[4] ? unhex32(rest[4], 'nonce') : randomBytes(32),
          mtIndex: rest[5] ? BigInt(rest[5]) : 0n,
        };
        const ledgerState = (await readLedger()).invoices.lookup(invoiceId);
        const type = Number(ledgerState.invoiceType);
        if (type === 0) await api.settleStandard(invoiceId, opening, coin);
        else if (type === 1) await api.settleMultiPayment(invoiceId, opening, coin);
        else await api.acceptDonation(invoiceId, opening, coin, value);

        const settled = await api.isSettled(invoiceId);
        console.log(JSON.stringify({ invoiceId: invoiceId.toString(), isSettled: settled, spentValue: value.toString() }, null, 2));
        break;
      }
      case 'settle': {
        const invoiceId = BigInt(rest[0] ?? '');
        await api.settleMulti(invoiceId);
        console.log(JSON.stringify({ invoiceId: invoiceId.toString(), settled: true }, null, 2));
        break;
      }
      case 'cancel': {
        const invoiceId = BigInt(rest[0] ?? '');
        await api.cancelInvoice(invoiceId);
        console.log(JSON.stringify({ invoiceId: invoiceId.toString(), cancelled: true }, null, 2));
        break;
      }
      case 'status': {
        const l = await readLedger();
        if (rest[0]) {
          const invoiceId = BigInt(rest[0]);
          if (!l.invoices.member(invoiceId)) {
            logger.error(`no invoice ${rest[0]}`);
            process.exitCode = 1;
            break;
          }
          console.log(invoiceJson(invoiceId, l.invoices.lookup(invoiceId)));
        } else {
          console.log(
            JSON.stringify(
              {
                address,
                explorer: `${EXPLORER}/contracts/0x${address}`,
                sequence: l.sequence.toString(),
              },
              null,
              2,
            ),
          );
        }
        break;
      }
      default:
        logger.error(`unknown command: ${command}`);
        process.exitCode = 1;
    }
  } finally {
    await stack.close();
  }
};

await run(process.argv.slice(2));
