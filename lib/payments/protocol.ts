import type { PaymentIntent } from './types'

/** Supported on-chain invoice contract families. Keep this explicit: never infer a contract from a record's shape. */
export type InvoiceProtocolVersion = 'v1' | 'v2' | 'v3'

export const ACTIVE_INVOICE_PROTOCOL: InvoiceProtocolVersion = 'v2'

export interface InvoiceProtocolMetadata {
  version: InvoiceProtocolVersion
  contractAddress?: string
  network: string
}

export function isInvoiceProtocolVersion(value: unknown): value is InvoiceProtocolVersion {
  return value === 'v1' || value === 'v2' || value === 'v3'
}

export function protocolFromMetadata(metadata: unknown): InvoiceProtocolVersion {
  if (metadata && typeof metadata === 'object' && isInvoiceProtocolVersion((metadata as { protocolVersion?: unknown }).protocolVersion)) {
    return (metadata as { protocolVersion: InvoiceProtocolVersion }).protocolVersion
  }
  // Existing records predate the explicit discriminator and are v2 records.
  return 'v2'
}

export function assertProtocolCompatibility(
  requested: unknown,
  supported: InvoiceProtocolVersion = ACTIVE_INVOICE_PROTOCOL,
): InvoiceProtocolVersion {
  const version = requested === undefined ? supported : requested
  if (!isInvoiceProtocolVersion(version)) {
    throw new Error('Unsupported invoice protocol. Use v1, v2, or v3.')
  }
  if (version !== supported) {
    throw new Error(`Invoice protocol ${version} is not active on this deployment (active: ${supported}).`)
  }
  return version
}

export function withProtocolMetadata(intent: PaymentIntent, metadata: InvoiceProtocolMetadata): PaymentIntent {
  return { ...intent, protocolVersion: metadata.version, network: metadata.network }
}

export function protocolMismatchError(expected: InvoiceProtocolVersion, actual: unknown): Error {
  return new Error(`Invoice protocol mismatch: expected ${expected}, received ${String(actual ?? 'unknown')}.`)
}

export const protocolLabel: Record<InvoiceProtocolVersion, string> = {
  v1: 'VeilPay v1',
  v2: 'VeilPay v2',
  v3: 'VeilPay v3',
}

export const protocolContractEnv: Record<InvoiceProtocolVersion, string> = {
  v1: 'NEXT_PUBLIC_VEILPAY_CONTRACT_ADDRESS_V1',
  v2: 'NEXT_PUBLIC_VEILPAY_CONTRACT_ADDRESS',
  v3: 'NEXT_PUBLIC_VEILPAY_CONTRACT_ADDRESS_V3',
}
