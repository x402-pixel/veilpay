# VeilPay v2 Contract Card

Live on Midnight Preprod. Source of truth: `deployments/preprod-v2.json`
(generated at deploy time, includes circuit verifier-key hashes).

```text
address       0x85a0f911bb554bf4b7e9a69bb2ee2c20a03b823b20274eade45c6b18f53583a7
deploy tx     0x80bc77767f62fe711c8f1095a261f5a5296de665d2523850ab9afdf8e5982ad2
block         2,521,381   (2026-09-12T19:22:17Z)
source        contract/src/veilpay2.compact
compiler      compactc 0.31.1   language 0.23.0   runtime 0.16.0
tests         21/21 in CI (11 dedicated v2 contract tests)
```

## Public ledger state

```text
sequence   Uint<64>                        // total intent operations, also the id source
intents    Map<Uint<64>, Intent>
receipts   Map<Uint<64>, Bytes<32>>        // one entry per paid intent (payer receipt)
```

```ts
type Intent = {
  merchantId:       Uint8Array /* 32 */;  // H(merchantSecretKey), pseudonymous
  merchantCoinPk:   Uint8Array /* 32 */;  // zswap coin pubkey paid tokens go to
  tokenColor:       Uint8Array /* 32 */;  // 0...0 = accepts ANY shielded token
  amount:           bigint;               // Uint<128>
  expiresAt:        bigint;               // Uint<64>, sequence bound (not wall clock)
  status:           IntentStatus;         // 0 ACTIVE | 1 PAID | 2 REFUNDED | 3 CANCELLED
  secretCommitment: Uint8Array /* 32 */;  // H("veilpay:intent:", id, paymentSecret)
  paidAmount:       bigint;               // Uint<128>
  refundedAmount:   bigint;               // Uint<128>
};
```

## Circuits

| Circuit | Arguments | Caller | Witnesses (private inputs) | Effect |
|---|---|---|---|---|
| `createIntent` | `amount: Uint<128>, expiresAt: Uint<64>, tokenColor: Bytes<32>, merchantCoinPk: Bytes<32>` | merchant | `merchantSecretKey`, `paymentSecret(id)` | inserts ACTIVE intent, returns its id (`Uint<64>`) |
| `pay` | `intentId: Uint<64>, coin: QualifiedShieldedCoinInfo{nonce,color,value,mt_index}` | payer (holds the secret) | `paymentSecret(intentId)`, `receiptSecret` | consumes payer coin, sends `amount` to `merchantCoinPk`, change back to payer, records receipt, marks PAID |
| `refund` | `intentId: Uint<64>, refundAmount: Uint<128>` | merchant only | `merchantSecretKey` | records refund on a PAID intent |
| `cancel` | `intentId: Uint<64>` | merchant only | `merchantSecretKey` | marks CANCELLED (unpaid only) |
| `isPaid` | `intentId: Uint<64>` | anyone (pure read) | — | true when status is PAID or REFUNDED |

Verifier-key hashes (for proving-endpoint debugging):
createIntent `078521a3...`, pay `0ee56847...` (full values in `deployments/preprod-v2.json`).

## Token support

The contract is token-agnostic across Midnight shielded (zswap) token colors.
`tokenColor = 0x0000...0000` (32 zero bytes) is an **open intent**: any token
color may settle it, the circuit checks `coin.color` matches when nonzero.
On preprod today the native shielded asset is NIGHT — an all-zero open intent
is what demo/test flows settle with.

## What "v2" means (one line)

v1 was an oracle: it verified that a payment condition was met and recorded
the fact, but never moved value. v2 runs the same privacy model **and**
settles real shielded tokens through zswap inside the `pay` circuit: this is
the NullPay mechanic (private transfer + receipt + commitment) rebuilt on
Midnight/Compact.
