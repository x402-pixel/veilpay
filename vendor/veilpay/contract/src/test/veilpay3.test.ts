import { VeilPay3Simulator, qualifiedCoin, type OpeningArgs } from "./veilpay3-simulator.js";
import { InvoiceStatus, InvoiceType } from "../managed/veilpay3/contract/index.js";
import { createVeilPay3PrivateState, withInvoiceOpening3 } from "../witnesses3.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";

setNetworkId("undeployed");

const AMOUNT = 1000n;
const FAR_FUTURE = 1_000_000n;
const ANY_TOKEN = new Uint8Array(32);
const merchantPk = () => randomBytes(32);

const baseArgs = (overrides: Partial<OpeningArgs> = {}): OpeningArgs & { expiresAt: bigint } => ({
  amount: AMOUNT,
  tokenColor: ANY_TOKEN,
  merchantCoinPk: merchantPk(),
  invoiceType: "standard",
  paymentSecret: randomBytes(32),
  salt: randomBytes(32),
  expiresAt: FAR_FUTURE,
  ...overrides,
});

describe("VeilPay v3 contract (private invoices)", () => {
  it("issues a standard invoice storing only commitments", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { ledger, invoiceId } = sim.issueInvoice(baseArgs());

    const state = ledger.invoices.lookup(invoiceId);
    expect(invoiceId).toEqual(1n);
    expect(state.status).toEqual(InvoiceStatus.ACTIVE);
    expect(state.invoiceType).toEqual(InvoiceType.STANDARD);
    expect(state.commitment.length).toEqual(32);
    expect(ledger.sequence).toEqual(1n);
  });

  it("rejects an opening that does not match the issued terms", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const args = baseArgs();
    const mismatched = { ...args, amount: AMOUNT + 1n };
    const nextId = 1n;
    sim.setPrivateState(
      withInvoiceOpening3(
        createVeilPay3PrivateState(randomBytes(32), randomBytes(32)),
        nextId,
        sim.buildOpening(mismatched),
      ),
    );

    expect(() =>
      sim.issueInvoice(args),
    ).toThrow("opening amount mismatch");
  });

  it("settles a standard invoice and moves the requested amount", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs());

    const result = sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32)));

    expect(sim.getLedger().invoices.lookup(invoiceId).status).toEqual(InvoiceStatus.PAID);
    expect(result.sent.value).toEqual(AMOUNT);
    expect(result.change.is_some).toEqual(false);
    expect(sim.getLedger().receipts.member(invoiceId)).toEqual(true);
  });

  it("returns change to the payer when the coin exceeds the amount", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs());

    const result = sim.settleStandard(
      invoiceId,
      qualifiedCoin(AMOUNT + 400n, randomBytes(32), randomBytes(32)),
    );

    expect(result.sent.value).toEqual(AMOUNT);
    expect(result.change.is_some).toEqual(true);
    expect(result.change.value?.value).toEqual(400n);
  });

  it("rejects a second settlement of the same standard invoice", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs());
    sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32)));

    expect(() =>
      sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32))),
    ).toThrow("invoice not active");
  });

  it("rejects a coin that cannot cover the invoice", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs());

    expect(() =>
      sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT - 1n, randomBytes(32), randomBytes(32))),
    ).toThrow("coin cannot cover invoice");
  });

  it("rejects the wrong token color when the invoice pins one", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs({ tokenColor: randomBytes(32) }));

    expect(() =>
      sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32))),
    ).toThrow("wrong token color");
  });

  it("rejects a settlement with no local opening", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs());
    sim.setPrivateState(createVeilPay3PrivateState(randomBytes(32), randomBytes(32)));

    expect(() =>
      sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32))),
    ).toThrow("No invoice opening known");
  });

  it("accepts repeated multi-pay settlements until the merchant settles", () => {
    const merchantKey = randomBytes(32);
    const sim = VeilPay3Simulator.deploy(merchantKey, randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs({ invoiceType: "multipay" }));

    sim.settleMultiPayment(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32)));
    expect(sim.getLedger().invoices.lookup(invoiceId).status).toEqual(InvoiceStatus.ACTIVE);

    sim.settleMultiPayment(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32)));
    expect(sim.getLedger().invoices.lookup(invoiceId).status).toEqual(InvoiceStatus.ACTIVE);

    const settled = sim.settleMulti(invoiceId);
    expect(settled.invoices.lookup(invoiceId).status).toEqual(InvoiceStatus.SETTLED);
  });

  it("rejects a settlement of a multi-pay campaign as standard", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs({ invoiceType: "multipay" }));

    expect(() =>
      sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32))),
    ).toThrow("invoice type invalid");
  });

  it("accepts variable donation amounts and returns change", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs({ amount: 0n, invoiceType: "donation" }));

    const result = sim.acceptDonation(
      invoiceId,
      qualifiedCoin(5000n, randomBytes(32), randomBytes(32)),
      200n,
    );
    expect(result.sent.value).toEqual(200n);
    expect(result.change.is_some).toEqual(true);
    expect(result.change.value?.value).toEqual(4800n);

    const again = sim.acceptDonation(invoiceId, qualifiedCoin(75n, randomBytes(32), randomBytes(32)), 75n);
    expect(again.sent.value).toEqual(75n);
    expect(sim.getLedger().invoices.lookup(invoiceId).status).toEqual(InvoiceStatus.ACTIVE);
  });

  it("rejects a zero or uncovered donation", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs({ amount: 0n, invoiceType: "donation" }));

    expect(() =>
      sim.acceptDonation(invoiceId, qualifiedCoin(100n, randomBytes(32), randomBytes(32)), 0n),
    ).toThrow("donation must be positive");
    expect(() =>
      sim.acceptDonation(invoiceId, qualifiedCoin(100n, randomBytes(32), randomBytes(32)), 101n),
    ).toThrow("coin cannot cover donation");
  });

  it("rejects settlement after the deadline", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const expiring = sim.issueInvoice(baseArgs({ expiresAt: 1n }));
    sim.issueInvoice(baseArgs());

    expect(() =>
      sim.settleStandard(expiring.invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32))),
    ).toThrow("invoice expired");
  });

  it("cancels an unpaid invoice and blocks later settlement", () => {
    const merchantKey = randomBytes(32);
    const sim = VeilPay3Simulator.deploy(merchantKey, randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs());

    const ledgerAfterCancel = sim.cancelInvoice(invoiceId);
    expect(ledgerAfterCancel.invoices.lookup(invoiceId).status).toEqual(InvoiceStatus.CANCELLED);
    expect(() =>
      sim.settleStandard(invoiceId, qualifiedCoin(AMOUNT, randomBytes(32), randomBytes(32))),
    ).toThrow("invoice not active");
  });

  it("rejects cancel from a different merchant key", () => {
    const sim = VeilPay3Simulator.deploy(randomBytes(32), randomBytes(32));
    const { invoiceId } = sim.issueInvoice(baseArgs());
    sim.setPrivateState(createVeilPay3PrivateState(randomBytes(32), randomBytes(32)));

    expect(() => sim.cancelInvoice(invoiceId)).toThrow("not the invoice merchant");
  });
});
