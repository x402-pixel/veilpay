/**
 * Client-safe VeilPay constants (no server-only imports — this module is
 * bundled into the browser). Mirrors the defaults in lib/veilpay-server.ts.
 */

export const VEILPAY_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_VEILPAY_CONTRACT_ADDRESS?.trim().replace(/^0x/i, '') ||
  '85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7'

/** Live VeilPay v3 (private invoices) contract on Midnight preprod (deployments/preprod-v3.json). */
export const VEILPAY_CONTRACT_ADDRESS_V3 =
  process.env.NEXT_PUBLIC_VEILPAY_CONTRACT_ADDRESS_V3?.trim().replace(/^0x/i, '') ||
  'aad2cd8b9a98c9b8f7c6f3edd562d895705c19d24eb122c5253b22187e950772'

export const VEILPAY_INDEXER_HTTP =
  process.env.NEXT_PUBLIC_VEILPAY_INDEXER_HTTP?.trim() ||
  'https://indexer.preprod.midnight.network/api/v3/graphql'

export const VEILPAY_INDEXER_WS =
  process.env.NEXT_PUBLIC_VEILPAY_INDEXER_WS?.trim() ||
  'wss://indexer.preprod.midnight.network/api/v3/graphql/ws'
