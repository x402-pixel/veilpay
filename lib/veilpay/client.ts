'use client'

/**
 * Client-side VeilPay v3 wallet flows — the browser wallet signs and relays
 * contract transactions; the server never holds keys.
 *
 * v3 keeps only the invoice commitment and lifecycle on the public ledger.
 * The amount, token color, merchant coin key, invoice type, payment secret
 * and salt live in private witnesses, so the payer reconstructs the opening
 * from the checkout link before proving settlement.
 *
 * Provider stack:
 *  - walletProvider: the injected extension (v4 dApp Connector API). Balances
 *    dApp-built unsealed transactions via `balanceUnsealedTransaction` and
 *    relays the sealed result via `submitTransaction`.
 *  - publicDataProvider: the public preprod indexer (runtime reads never use
 *    the authenticated gateway session).
 *  - privateStateProvider: in-memory (payment secrets never leave the browser).
 *  - proofProvider: the extension's prover via dappConnectorProofProvider.
 */

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id'
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
import { toHex } from '@midnight-ntwrk/midnight-js-utils'
import { Transaction } from '@midnight-ntwrk/ledger-v8'
import type {
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types'
import { ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types'
import { dappConnectorProofProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider'
import { CostModel, type FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger'
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api'
import { VeilPay3API } from '../../vendor/veilpay/api/src/index3'
import { connectWalletApi } from '@/lib/wallet/detect'
import {
  VEILPAY_CONTRACT_ADDRESS_V3,
  VEILPAY_INDEXER_HTTP,
  VEILPAY_INDEXER_WS,
} from '@/lib/veilpay/config'

const unhex = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '')
  if (clean.length % 2 !== 0) throw new Error('odd-length hex string')
  return new Uint8Array(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
}

/**
 * Minimal bech32m decoder — converts the connector's bech32m
 * `shieldedCoinPublicKey` into the raw 32-byte hex the contract expects.
 */
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function bech32mDecode(bech: string): Uint8Array {
  const pos = bech.lastIndexOf('1')
  if (pos < 1 || pos + 7 > bech.length) throw new Error('invalid bech32m string')
  const dataPart = bech.slice(pos + 1).toLowerCase()
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const ch of dataPart) {
    const v = CHARSET.indexOf(ch)
    if (v === -1) throw new Error('invalid bech32m character')
    acc = (acc << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/** Extension-backed midnight-js wallet provider. */
function createExtensionWalletProvider(api: ConnectedAPI, coinPkHex: string, encPkHex: string): WalletProvider {
  return {
    async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
      const serialized = toHex(tx.serialize())
      const { tx: balanced } = await api.balanceUnsealedTransaction(serialized, { payFees: true })
      return Transaction.deserialize('signature', 'proof', 'binding', unhex(balanced)) as never
    },
    getCoinPublicKey: () => coinPkHex as never,
    getEncryptionPublicKey: () => encPkHex as never,
  }
}

/** In-memory private state provider — secrets never leave the browser. */
function createInMemoryPrivateStateProvider() {
  const store = new Map<string, unknown>()
  let contractAddress: string | undefined
  const scoped = (id: string) => `${contractAddress ?? 'global'}:${id}`
  return {
    setContractAddress(address: string) {
      contractAddress = address
    },
    async get(id: string) {
      return store.get(scoped(id))
    },
    async set(id: string, state: unknown) {
      store.set(scoped(id), state)
    },
  }
}

export interface IssuedInvoice {
  chainIntentId: string
  expiresAtOps: string
  merchantCoinPk: string
  tokenColor: string
  paymentSecret: string
  salt: string
  invoiceType: string
}

export interface IssueInvoiceArgs {
  /** Amount in micro-units (6 decimals). */
  amountMicro: bigint
  /** Ledger-operation TTL from the current sequence. */
  ttlOps: number
  /** 32-byte token color; zero bytes = open invoice (any shielded token). */
  tokenColor?: Uint8Array
  /** Invoice type: 'standard' (default), 'multipay' or 'donation'. */
  invoiceType?: 'standard' | 'multipay' | 'donation'
}

let cachedConnection: { api: ConnectedAPI; coinPkHex: string; encPkHex: string } | null = null

/** Connect the extension and resolve the merchant's coin public key (hex). */
export async function connectMerchantWallet(walletId: string): Promise<{ coinPkHex: string }> {
  if (cachedConnection) return { coinPkHex: cachedConnection.coinPkHex }

  const { api: looseApi } = await connectWalletApi(walletId)
  const api = looseApi as unknown as ConnectedAPI
  const addresses = await api.getShieldedAddresses()

  cachedConnection = {
    api,
    coinPkHex: toHex(bech32mDecode(addresses.shieldedCoinPublicKey)),
    encPkHex: toHex(bech32mDecode(addresses.shieldedEncryptionPublicKey)),
  }
  return { coinPkHex: cachedConnection.coinPkHex }
}

/**
 * Circuit key material served from the compiled v3 artifacts in
 * public/veilpay/managed-v3/. Extends the official ZKConfigProvider abstract
 * class so the concrete getVerifierKeys/get/asKeyMaterialProvider methods
 * come from midnight-js itself — findDeployedContract calls
 * getVerifierKeys(circuitIds) when joining the deployed contract.
 */
class ManagedCircuitZKConfigProvider extends ZKConfigProvider<string> {
  private async fetchArtifact(path: string): Promise<Uint8Array> {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`Failed to load circuit artifact ${path}: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  // Mirrors the official NodeZkConfigProvider/FetchZkConfigProvider layout:
  // zkir/{circuit}.bzkir (binary ZKIR) and keys/{circuit}.verifier. This
  // compactc generation emits no separate .prover files — the proving
  // material travels inside the .bzkir the proof server consumes — so
  // getProverKey serves those same bytes if the wallet requests them.
  override getZKIR(circuitId: string) {
    return this.fetchArtifact(`/veilpay/managed-v3/zkir/${circuitId}.bzkir`) as never
  }

  override getProverKey(circuitId: string) {
    return this.fetchArtifact(`/veilpay/managed-v3/zkir/${circuitId}.bzkir`) as never
  }

  override getVerifierKey(circuitId: string) {
    return this.fetchArtifact(`/veilpay/managed-v3/keys/${circuitId}.verifier`) as never
  }

  // The extension copies the key material into its own context, where class
  // prototype methods are lost, and its internal proof flow calls the batched
  // getVerifierKeys on the copied object. The base class returns `this` here,
  // which would hand over prototype-only methods — override it with a plain
  // object whose every method is an OWN property, batched form included.
  override asKeyMaterialProvider() {
    return {
      getZKIR: (circuitId: string) => this.getZKIR(circuitId),
      getProverKey: (circuitId: string) => this.getProverKey(circuitId),
      getVerifierKey: (circuitId: string) => this.getVerifierKey(circuitId),
      getVerifierKeys: async (circuitIds: string | readonly string[]) => {
        const ids = Array.isArray(circuitIds) ? circuitIds : [circuitIds]
        return Promise.all(ids.map(async (id) => [id, await this.getVerifierKey(id)] as const))
      },
    }
  }
}

/** Build the full midnight-js provider stack backed by the extension + public indexer. */
async function buildProviderStack(api: ConnectedAPI, coinPkHex: string, encPkHex: string) {
  const walletProvider = createExtensionWalletProvider(api, coinPkHex, encPkHex)
  const publicDataProvider = indexerPublicDataProvider(VEILPAY_INDEXER_HTTP, VEILPAY_INDEXER_WS)
  const zkConfigProvider = new ManagedCircuitZKConfigProvider()

  // Mirrors the repo's working CLI wiring (cli/src/gateway-cli3.ts): proofProvider
  // (not provingProvider) plus midnightProvider are both required by
  // MidnightProviders — omitting either breaks findDeployedContract.
  return {
    privateStateProvider: createInMemoryPrivateStateProvider(),
    publicDataProvider,
    walletProvider,
    midnightProvider: walletProvider,
    proofProvider: await dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel()),
    zkConfigProvider,
  }
}

/**
 * Issue an on-chain v3 invoice from the merchant's wallet.
 *
 * Builds and proves the `issueInvoice` call client-side, balances and submits
 * it through the extension, then returns the issuance result (including the
 * generated payment secret and salt) for registration with the server.
 */
export async function issueInvoice(walletId: string, args: IssueInvoiceArgs): Promise<IssuedInvoice> {
  setNetworkId('preprod')

  const { api, coinPkHex, encPkHex } = cachedConnection
    ? cachedConnection
    : await connectMerchantWallet(walletId).then(() => cachedConnection!)

  const providers = await buildProviderStack(api, coinPkHex, encPkHex)
  const contractApi = await VeilPay3API.join(providers as never, VEILPAY_CONTRACT_ADDRESS_V3 as never)

  // Read the current sequence from the public ledger to derive the expiry.
  const state = await providers.publicDataProvider.queryContractState(VEILPAY_CONTRACT_ADDRESS_V3)
  const veilpay3 = await import('../../vendor/veilpay/contract/src/managed/veilpay3/contract/index.js')
  const sequence = state ? veilpay3.ledger(state.data).sequence : 0n
  const expiresAt = sequence + BigInt(args.ttlOps)

  const tokenColor = args.tokenColor ?? new Uint8Array(32)
  const issued = await contractApi.issueInvoice({
    amount: args.amountMicro,
    tokenColor,
    merchantCoinPk: unhex(coinPkHex),
    invoiceType: args.invoiceType ?? 'standard',
    expiresAt,
  })

  return {
    chainIntentId: issued.invoiceId,
    expiresAtOps: issued.expiresAt,
    merchantCoinPk: issued.merchantCoinPk,
    tokenColor: issued.tokenColor,
    paymentSecret: issued.paymentSecret,
    salt: issued.salt,
    invoiceType: issued.invoiceType,
  }
}

/** A spendable shielded coin the payer selected in their synced wallet. */
export interface PayerCoin {
  /** 32-byte hex coin nonce. */
  nonce: string
  /** 32-byte hex token color (zero bytes = native/open). */
  color: string
  /** Coin value in micro-units. */
  value: bigint
  /** Merkle-tree index of the coin commitment. */
  mtIndex: bigint
}

/** The private invoice opening the payer reconstructs from the checkout link. */
export interface InvoiceOpeningParams {
  /** Amount in micro-units (6 decimals). */
  amountMicro: bigint
  /** 32-byte hex token color (zero bytes = open invoice). */
  tokenColor: string
  /** 32-byte hex merchant zswap coin public key (settlement destination). */
  merchantCoinPk: string
  /** Invoice type: 'standard', 'multipay' or 'donation'. */
  invoiceType: 'standard' | 'multipay' | 'donation'
  /** 64-hex payment secret from the checkout link. */
  paymentSecret: string
  /** 64-hex salt from the checkout link. */
  salt: string
}

/**
 * Settle a standard invoice from the payer's wallet: proves and submits the
 * v3 `settleStandard(invoiceId, opening, coin)` circuit call, spending a real
 * shielded coin (change returns to the payer). The opening — including the
 * claim code — is reconstructed client-side and proven in zero knowledge;
 * only the commitment was ever public.
 *
 * Coin discovery requires a funded, synced shielded wallet — the extension
 * API does not enumerate coins yet, so the coin is supplied explicitly.
 */
export async function payInvoice(
  walletId: string,
  args: { chainIntentId: string; opening: InvoiceOpeningParams; coin: PayerCoin },
): Promise<{ submitted: true }> {
  setNetworkId('preprod')

  const { api, coinPkHex, encPkHex } = cachedConnection
    ? cachedConnection
    : await connectMerchantWallet(walletId).then(() => cachedConnection!)

  const providers = await buildProviderStack(api, coinPkHex, encPkHex)
  const contractApi = await VeilPay3API.join(providers as never, VEILPAY_CONTRACT_ADDRESS_V3 as never)

  const { opening } = contractApi.buildOpening({
    amount: args.opening.amountMicro,
    tokenColor: unhex(args.opening.tokenColor),
    merchantCoinPk: unhex(args.opening.merchantCoinPk),
    invoiceType: args.opening.invoiceType,
    paymentSecret: unhex(args.opening.paymentSecret),
    salt: unhex(args.opening.salt),
  })

  await contractApi.settleStandard(BigInt(args.chainIntentId), opening, {
    nonce: unhex(args.coin.nonce),
    color: unhex(args.coin.color),
    value: args.coin.value,
    mtIndex: args.coin.mtIndex,
  })

  return { submitted: true }
}
