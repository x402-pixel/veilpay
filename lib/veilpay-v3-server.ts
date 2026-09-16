/**
 * Server-only VeilPay v3 protocol integration (read + write paths).
 *
 * v3 (deployments/preprod-v3.json in the vendored repo) keeps only the
 * invoice commitment and lifecycle on the public ledger; the amount, token
 * color, merchant coin key, invoice type, payment secret and salt travel
 * through private witnesses. The server issues invoices over the vendored
 * gateway stack (hosted proving, sponsored balancing, RPC submission via
 * api-preprod.1am.xyz) exactly like the v2 write path.
 *
 * Reads use the public, unauthenticated Midnight preprod indexer plus the
 * committed compiled ledger decoder under
 * vendor/veilpay/contract/src/managed/veilpay3/.
 *
 * The vendored ESM workspaces are loaded through a runtime dynamic import so
 * the Next.js bundler never inlines their dependency tree.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Live VeilPay v3 (private invoices) contract on Midnight preprod (deployments/preprod-v3.json). */
export const VEILPAY_CONTRACT_ADDRESS_V3 =
  process.env.VEILPAY_CONTRACT_ADDRESS_V3?.trim() ||
  '0xaad2cd8b9a98c9b8f7c6f3edd562d895705c19d24eb122c5253b22187e950772'

export const VEILPAY_NETWORK_V3 = 'preprod'

/** Public, unauthenticated preprod indexer (same as the v2 read path). */
export const VEILPAY_INDEXER_HTTP_V3 =
  process.env.VEILPAY_INDEXER_HTTP?.trim() ||
  'https://indexer.preprod.midnight.network/api/v3/graphql'
export const VEILPAY_INDEXER_WS_V3 =
  process.env.VEILPAY_INDEXER_WS?.trim() ||
  'wss://indexer.preprod.midnight.network/api/v3/graphql/ws'

const VENDOR_ROOT = join(process.cwd(), 'vendor', 'veilpay')
const MANAGED_ARTIFACT_V3 = join(
  VENDOR_ROOT,
  'contract',
  'src',
  'managed',
  'veilpay3',
  'contract',
  'index.js',
)
const GATEWAY_STACK_JS = join(VENDOR_ROOT, 'cli', 'src', 'gateway-stack.js')
const VEILPAY3_API_JS = join(VENDOR_ROOT, 'api', 'src', 'index3.js')

export interface VeilPayV3Readiness {
  ready: boolean
  network: string
  contractAddress: string
  artifactsPresent: boolean
  missing: string[]
}

export function getVeilPayV3Readiness(): VeilPayV3Readiness {
  const artifactsPresent = existsSync(MANAGED_ARTIFACT_V3)

  const missing: string[] = []
  if (!artifactsPresent) {
    missing.push(
      'Compiled v3 contract artifacts: build the vendored repo (tsc) so vendor/veilpay/contract/src/managed/veilpay3/ exists',
    )
  }

  return {
    ready: missing.length === 0,
    network: VEILPAY_NETWORK_V3,
    contractAddress: VEILPAY_CONTRACT_ADDRESS_V3,
    artifactsPresent,
    missing,
  }
}

function dynamicImport(specifier: string): Promise<unknown> {
  // Escape the bundler: the vendored ESM workspaces must resolve their own
  // dependencies at runtime, not be inlined by Turbopack/webpack.
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    s: string,
  ) => Promise<unknown>
  return runtimeImport(specifier)
}

/** v3 on-chain invoice status enum order (veilpay3.compact InvoiceStatus). */
export type VeilPayV3ChainStatus = 'ACTIVE' | 'PAID' | 'SETTLED' | 'CANCELLED'

/** v3 invoice type enum order (veilpay3.compact InvoiceType). */
export type VeilPayV3InvoiceType = 'STANDARD' | 'MULTI_PAY' | 'DONATION'

/** v3 InvoiceState projected to plain JSON-safe values (commitment stays opaque). */
export interface VeilPayV3ChainInvoice {
  id: string
  status: VeilPayV3ChainStatus
  invoiceType: VeilPayV3InvoiceType
  /** Ledger-operations deadline (sequence units), NOT wall-clock time. */
  expiresAtOps: string
  /** Receipt commitment hex when the invoice is settled, else null. */
  receipt: string | null
}

/** Parsed v3 ledger shape produced by the managed contract's ledger() function. */
interface ParsedV3Ledger {
  sequence: bigint
  invoices: {
    member(id: bigint): boolean
    lookup(id: bigint): {
      commitment: unknown
      merchantAuth: unknown
      invoiceType: unknown
      expiresAt: unknown
      status: unknown
    }
  }
  receipts: {
    member(id: bigint): boolean
    lookup(id: bigint): unknown
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __veilpay_v3_ledger_provider__: Promise<{
    queryContractState(address: string): Promise<{ data: unknown } | null>
  }> | undefined
}

async function getV3LedgerProvider() {
  if (!globalThis.__veilpay_v3_ledger_provider__) {
    globalThis.__veilpay_v3_ledger_provider__ = (async () => {
      const bootstrapUrl = pathToFileURL(join(VENDOR_ROOT, 'public-bootstrap.mjs')).href
      const { createPublicLedgerProvider } = (await dynamicImport(bootstrapUrl)) as {
        createPublicLedgerProvider(
          indexerHttp: string,
          indexerWs: string,
        ): Promise<{ queryContractState(address: string): Promise<{ data: unknown } | null> }>
      }
      return createPublicLedgerProvider(VEILPAY_INDEXER_HTTP_V3, VEILPAY_INDEXER_WS_V3)
    })().catch((err) => {
      // Do not cache failures: a transient indexer outage should retry.
      globalThis.__veilpay_v3_ledger_provider__ = undefined
      throw err
    })
  }
  return globalThis.__veilpay_v3_ledger_provider__
}

async function loadV3LedgerDecoder(): Promise<(data: unknown) => ParsedV3Ledger> {
  const { ledger } = (await dynamicImport(pathToFileURL(MANAGED_ARTIFACT_V3).href)) as {
    ledger: (data: unknown) => ParsedV3Ledger
  }
  return ledger
}

/**
 * Read the live v3 ledger through the public indexer. Retries briefly —
 * the indexer intermittently returns null for very recent contracts.
 */
export async function readVeilPayV3Ledger(): Promise<ParsedV3Ledger> {
  const readiness = getVeilPayV3Readiness()
  if (!readiness.ready) {
    throw new VeilPayV3UnavailableError(readiness.missing)
  }

  const provider = await getV3LedgerProvider()
  const address = VEILPAY_CONTRACT_ADDRESS_V3.replace(/^0x/, '')

  let state: { data: unknown } | null = null
  for (let attempt = 1; attempt <= 5 && !state; attempt++) {
    state = await provider.queryContractState(address)
    if (!state) await new Promise((r) => setTimeout(r, 3000))
  }
  if (!state?.data) {
    throw new Error('Unable to read VeilPay v3 contract ledger state from the public indexer.')
  }

  const ledger = await loadV3LedgerDecoder()
  return ledger(state.data)
}

function readEnumTag(value: unknown): string {
  let v: unknown = value
  if (v && typeof v === 'object' && 'is' in (v as Record<string, unknown>)) {
    v = (v as Record<string, unknown>).is
  }
  return String(v)
}

const STATUS_NAMES: Record<string, VeilPayV3ChainStatus> = {
  '0': 'ACTIVE',
  '1': 'PAID',
  '2': 'SETTLED',
  '3': 'CANCELLED',
}

const TYPE_NAMES: Record<string, VeilPayV3InvoiceType> = {
  '0': 'STANDARD',
  '1': 'MULTI_PAY',
  '2': 'DONATION',
}

/** Read one invoice directly from the on-chain v3 ledger. */
export async function getV3ChainInvoice(
  chainInvoiceId: string,
): Promise<VeilPayV3ChainInvoice | null> {
  const ledgerState = await readVeilPayV3Ledger()
  const id = BigInt(chainInvoiceId)
  if (!ledgerState.invoices.member(id)) return null

  const raw = ledgerState.invoices.lookup(id)
  const receipt = ledgerState.receipts.member(id)
    ? toHex(ledgerState.receipts.lookup(id))
    : null

  return {
    id: chainInvoiceId,
    status: STATUS_NAMES[readEnumTag(raw.status)] ?? 'ACTIVE',
    invoiceType: TYPE_NAMES[readEnumTag(raw.invoiceType)] ?? 'STANDARD',
    expiresAtOps: String(raw.expiresAt ?? '0'),
    receipt,
  }
}

/** Map an on-chain v3 invoice status to the application status model. */
export function mapV3StatusToAppStatus(status: VeilPayV3ChainStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'awaiting_payment'
    case 'PAID':
    case 'SETTLED':
      return 'verified'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'awaiting_payment'
  }
}

export class VeilPayV3UnavailableError extends Error {
  readonly missing: string[]
  constructor(missing: string[]) {
    super(
      `VeilPay v3 protocol integration is not ready. Missing: ${missing.join('; ')}`,
    )
    this.name = 'VeilPayV3UnavailableError'
    this.missing = missing
  }
}

function toHex(value: unknown): string {
  if (value instanceof Uint8Array) {
    return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return String(value)
}

/* ------------------------------------------------------------------ */
/* Write path: server-issued v3 invoices over the gateway stack        */
/* ------------------------------------------------------------------ */

/** Minimal pino-compatible console logger (avoids bundling pino into the app). */
const logger = {
  trace: (...args: unknown[]) => console.debug('[veilpay-v3]', ...args),
  debug: (...args: unknown[]) => console.debug('[veilpay-v3]', ...args),
  info: (...args: unknown[]) => console.info('[veilpay-v3]', ...args),
  warn: (...args: unknown[]) => console.warn('[veilpay-v3]', ...args),
  error: (...args: unknown[]) => console.error('[veilpay-v3]', ...args),
}

/** The subset of VeilPay3API the server write path uses. */
export interface VeilPay3ApiLike {
  readonly deployedContractAddress: string
  issueInvoice(args: {
    amount: bigint
    tokenColor: Uint8Array
    merchantCoinPk: Uint8Array
    invoiceType: 'standard' | 'multipay' | 'donation'
    expiresAt: bigint
  }): Promise<{
    invoiceId: string
    paymentSecret: string
    salt: string
    merchantCoinPk: string
    tokenColor: string
    expiresAt: string
    invoiceType: string
  }>
}

/** The subset of the gateway stack the server write path uses. */
export interface GatewayStackProvidersLike {
  walletProvider: { getCoinPublicKey(): unknown }
  publicDataProvider: {
    queryContractState(address: string): Promise<{ data: unknown } | null>
  }
}

export interface VeilPayV3 {
  api: VeilPay3ApiLike
  providers: GatewayStackProvidersLike
  /** Contract address WITHOUT the 0x prefix (midnight-js convention). */
  address: string
  close(): Promise<void>
}

declare global {
  // eslint-disable-next-line no-var
  var __veilpay_v3_singleton__: Promise<VeilPayV3> | undefined
}

/**
 * Resolve and create the writable state dir. MUST run before gateway-stack.js
 * is imported — it reads VEILPAY_STATE_DIR once at module load.
 */
function ensureStateDir(): string {
  if (!process.env.VEILPAY_STATE_DIR) {
    process.env.VEILPAY_STATE_DIR = process.env.VERCEL
      ? '/tmp/veilpay-state'
      : join(process.cwd(), '.veilpay-state')
  }
  const dir = process.env.VEILPAY_STATE_DIR
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Join the deployed v3 contract through the gateway stack. Cached per
 * process; failures are not cached so a transient gateway outage retries.
 */
export async function veilpayV3(): Promise<VeilPayV3> {
  if (!globalThis.__veilpay_v3_singleton__) {
    globalThis.__veilpay_v3_singleton__ = (async () => {
      ensureStateDir()

      const { buildGatewayStack } = (await dynamicImport(
        pathToFileURL(GATEWAY_STACK_JS).href,
      )) as {
        buildGatewayStack(
          logger: unknown,
          opts: {
            version: 'v3'
            privateStateStoreName: string
            deployTxHash?: string
          },
        ): Promise<{
          providers: GatewayStackProvidersLike
          close(): Promise<void>
        }>
      }
      const { VeilPay3API } = (await dynamicImport(
        pathToFileURL(VEILPAY3_API_JS).href,
      )) as {
        VeilPay3API: {
          join(
            providers: GatewayStackProvidersLike,
            address: string,
            logger: unknown,
          ): Promise<VeilPay3ApiLike>
        }
      }

      const stack = await buildGatewayStack(logger, {
        version: 'v3',
        privateStateStoreName: 'veilpay3-private-state',
        // Optional fast path: when the v3 deploy tx hash is known, the
        // inclusion watch polls the indexer by hash instead of by address.
        // Upstream's ContractCall->deploy query fix makes join work without
        // it, so this is only an optimization when the env var is set.
        deployTxHash: process.env.VEILPAY_DEPLOY_TX_V3,
      })
      const address = VEILPAY_CONTRACT_ADDRESS_V3.replace(/^0x/, '')
      const api = await VeilPay3API.join(stack.providers, address, logger)
      return { api, providers: stack.providers, address, close: stack.close }
    })().catch((err) => {
      // Do not cache failures: a cold-start hiccup should retry cleanly.
      globalThis.__veilpay_v3_singleton__ = undefined
      throw err
    })
  }
  return globalThis.__veilpay_v3_singleton__
}
