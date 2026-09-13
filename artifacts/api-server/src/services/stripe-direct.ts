import Stripe from "stripe";

function requiredSecret(name: "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

export function stripeClient() {
  return new Stripe(requiredSecret("STRIPE_SECRET_KEY"));
}

export function subscriptionPriceId() {
  const value = process.env.STRIPE_PRICE_ID?.trim();
  if (!value) throw new Error("STRIPE_PRICE_ID must be configured.");
  return value;
}

async function customersForEmail(email: string) {
  const stripe = stripeClient();
  const result = await stripe.customers.list({ email, limit: 10 });
  return result.data.filter((customer) => !customer.deleted);
}

export async function findStripeCustomer(email: string) {
  return (await customersForEmail(email))[0] ?? null;
}

export async function hasActivePaidAccess(email: string) {
  return (await getStripeBillingStatus(email)).active;
}

export async function getStripeBillingStatus(email: string) {
  const stripe = stripeClient();
  const approvedPriceId = subscriptionPriceId();
  let active = false;
  let latestPayment: {
    amount: number | null;
    currency: string | null;
    created: number;
    mode: "payment" | "setup" | "subscription";
  } | null = null;
  for (const customer of await customersForEmail(email)) {
    const subscriptions = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 100 });
    if (subscriptions.data.some((subscription) =>
      ["active", "trialing"].includes(subscription.status)
      && subscription.items.data.some((item) => item.price.id === approvedPriceId)
    )) active = true;
    const sessions = await stripe.checkout.sessions.list({ customer: customer.id, limit: 20 });
    const paid = sessions.data.find((session) => session.status === "complete" && session.payment_status === "paid");
    if (paid && (!latestPayment || paid.created > latestPayment.created)) {
      latestPayment = {
        amount: paid.amount_total,
        currency: paid.currency,
        created: paid.created,
        mode: paid.mode === "subscription" ? "subscription" : paid.mode === "setup" ? "setup" : "payment",
      };
    }
  }
  return { active, latestPayment };
}

export function verifyStripeWebhook(payload: Buffer, signature: string) {
  return stripeClient().webhooks.constructEvent(payload, signature, requiredSecret("STRIPE_WEBHOOK_SECRET"));
}