import { createRequire } from "node:module";
const RealStripe = createRequire(import.meta.url)("stripe");
export const fixture = { active: false, refunded: false, settled: false, checkouts: 0 };
const owner = () => process.env.PAYMENT_TEST_USER!;
const customer = "cus_billing_fixture";
export default class StripeMock {
  webhooks = new RealStripe("sk_test_fixture_only").webhooks;
  prices = { retrieve: async (id: string) => ({ id, active: true, unit_amount: 9900, currency: "usd", billing_scheme: "per_unit", type: "recurring", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } }) };
  customers = { create: async () => ({ id: customer }) };
  checkout = { sessions: {
    create: async () => { fixture.checkouts++; return { id: "cs_test_billing_primary", url: "https://checkout.stripe.com/c/pay/billing_fixture" }; },
    retrieve: async (id: string) => ({
      id, customer: id === "cs_test_foreign" ? "cus_foreign" : customer,
      client_reference_id: id === "cs_test_foreign" ? "foreign_user" : owner(),
      metadata: { neurotext_user_id: owner() }, line_items: { data: [{ price: { id: "price_billing_fixture" } }] },
      status: fixture.settled ? "complete" : "open", payment_status: fixture.settled ? "paid" : "unpaid",
      amount_total: 9900, subscription: "sub_billing_fixture", payment_intent: "pi_billing_fixture",
      url: "https://checkout.stripe.com/c/pay/billing_fixture",
    }),
  } };
  subscriptions = {
    list: async () => ({ data: fixture.active && fixture.settled ? [{
      id: "sub_billing_fixture", status: "active",
      items: { data: [{ price: { id: "price_billing_fixture" }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      latest_invoice: { id: "in_billing_fixture", status: "paid", amount_paid: 9900 },
    }] : [] }),
    retrieve: async () => ({ status: fixture.active ? "active" : "canceled" }),
  };
  invoicePayments = { list: async () => ({ data: [{ payment: { payment_intent: "pi_billing_fixture" } }] }) };
  paymentIntents = { retrieve: async () => ({ status: "succeeded", latest_charge: { paid: true, disputed: false, amount_refunded: fixture.refunded ? 9900 : 0 } }) };
  charges = { retrieve: async () => ({ customer }) };
  billingPortal = { sessions: { create: async () => ({ url: "https://billing.stripe.com/p/session/billing_fixture" }) } };
}
