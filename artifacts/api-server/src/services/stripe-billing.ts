import Stripe from "stripe";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { developmentOwnerMode, DEVELOPMENT_OWNER_ID } from "./account-session";

let client: Stripe | undefined;
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe payments are not configured.");
  return client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 20000, maxNetworkRetries: 1 });
}
export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET && process.env.PUBLIC_BASE_URL);
export function billingOrigin() {
  const url = new URL(process.env.PUBLIC_BASE_URL || "");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")) throw new Error("PUBLIC_BASE_URL must be the public HTTPS origin.");
  return url.origin;
}
export async function isOwner(owner?: string): Promise<boolean> {
  if (developmentOwnerMode()) return true;
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || owner === DEVELOPMENT_OWNER_ID) return false;
  const { rows: [row] } = await pool.query("SELECT email,google_sub FROM neurotext_users WHERE id=$1", [owner]);
  if (!row || row.google_sub === DEVELOPMENT_OWNER_ID) return false;
  const actualEmail = row.email.trim().toLowerCase();
  // The explicitly designated owner remains recognized on Coolify even if an
  // optional OWNER_EMAIL override was not copied from the development secrets.
  const ownerDigest = "fda68b8a25c292d62e6b7830208f60ed2f31fde9e16c056527e93ecc0e92935f";
  return actualEmail === email || createHash("sha256").update(actualEmail).digest("hex") === ownerDigest;
}
export async function hasPaidAccess(owner?: string): Promise<boolean> {
  if (await isOwner(owner)) return true;
  if (!owner) return false;
  const { rows: [row] } = await pool.query("SELECT access_status, access_until FROM neurotext_billing WHERE user_id=$1", [owner]);
  return row?.access_status === "paid" && (!row.access_until || new Date(row.access_until).getTime() > Date.now());
}
let cachedPrice: { until: number; price: Stripe.Price } | undefined;
export async function configuredPrice() {
  if (!billingConfigured()) throw new Error("Stripe payments are not configured.");
  if (cachedPrice && cachedPrice.until > Date.now() && cachedPrice.price.id === process.env.STRIPE_PRICE_ID) return cachedPrice.price;
  const price = await stripeClient().prices.retrieve(process.env.STRIPE_PRICE_ID!);
  if (!price.active || !price.unit_amount || price.unit_amount <= 0 || price.billing_scheme !== "per_unit" ||
      price.recurring?.usage_type === "metered") throw new Error("The configured Stripe price must be an active, positive fixed price.");
  cachedPrice = { until: Date.now() + 60000, price };
  return price;
}
const idOf = (value: any): string | undefined => typeof value === "string" ? value : value?.id;
async function usablePaymentIntent(id: string) {
  const payment = await stripeClient().paymentIntents.retrieve(id, { expand: ["latest_charge"] });
  const charge = typeof payment.latest_charge === "object" ? payment.latest_charge : null;
  return payment.status === "succeeded" && Boolean(charge && charge.paid && !charge.disputed && charge.amount_refunded === 0);
}

// Query Stripe's current state instead of granting from a return URL, browser
// flag, stale webhook order, or an unrelated customer's subscription.
export async function refreshBilling(owner: string, checkoutId?: string) {
  const db = await pool.connect();
  let locked = false;
  try {
    const { rows: [lock] } = await db.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired", [`neurotext-billing:${owner}`]);
    locked = lock.acquired;
    if (!locked) throw new Error("Payment synchronization is already running; check again shortly.");
    return await refreshBillingLocked(owner, checkoutId, db);
  } finally {
    try { if (locked) await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`neurotext-billing:${owner}`]); }
    finally { db.release(); }
  }
}
async function refreshBillingLocked(owner: string, checkoutId: string | undefined, db: Pick<typeof pool, "query">) {
  const stripe = stripeClient();
  const { rows: [row] } = await db.query("SELECT * FROM neurotext_billing WHERE user_id=$1", [owner]);
  if (!row?.stripe_customer_id) {
    if (checkoutId) throw new Error("No Stripe customer is linked to this Google account.");
    return false;
  }
  const sid = checkoutId || row.stripe_checkout_id;
  let verifiedSession: Stripe.Checkout.Session | undefined;
  if (sid) {
    const session = await stripe.checkout.sessions.retrieve(sid, { expand: ["line_items"] });
    if (idOf(session.customer) !== row.stripe_customer_id || session.client_reference_id !== owner ||
        session.metadata?.neurotext_user_id !== owner) throw new Error("This payment does not belong to the signed-in Google account.");
    if (session.line_items?.data.some(item => item.price?.id === process.env.STRIPE_PRICE_ID) &&
        session.status === "complete" && session.payment_status === "paid" && (session.amount_total || 0) > 0) verifiedSession = session;
  }
  let paid = false;
  let until: Date | null = null;
  let subscriptionId: string | null = null;
  const price = await configuredPrice();
  if (price.type === "recurring") {
    const subscriptions = await stripe.subscriptions.list({ customer: row.stripe_customer_id, status: "all", limit: 100, expand: ["data.latest_invoice"] });
    for (const subscription of subscriptions.data) {
      const item = subscription.items.data.find(item => item.price.id === price.id);
      const invoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
      if (subscription.status !== "active" || !item || !invoice || invoice.status !== "paid" || invoice.amount_paid <= 0) continue;
      const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 100 });
      let settled = false;
      for (const payment of payments.data) {
        const paymentId = idOf(payment.payment.payment_intent);
        if (paymentId && await usablePaymentIntent(paymentId)) { settled = true; break; }
      }
      if (settled && item.current_period_end * 1000 > Date.now()) {
        paid = true; until = new Date(item.current_period_end * 1000); subscriptionId = subscription.id; break;
      }
    }
  } else if (verifiedSession) {
    const paymentId = idOf(verifiedSession.payment_intent);
    paid = Boolean(paymentId && await usablePaymentIntent(paymentId));
  }
  await db.query(`UPDATE neurotext_billing SET access_status=$2,access_until=$3,
    stripe_subscription_id=$4,updated_at=now() WHERE user_id=$1`, [owner, paid ? "paid" : "unpaid", until, subscriptionId]);
  return paid;
}

export async function createCheckout(owner: string) {
  if (await hasPaidAccess(owner)) throw new Error("Your account already has full access. No payment is needed.");
  const stripe = stripeClient();
  const price = await configuredPrice();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO neurotext_billing(user_id) VALUES($1) ON CONFLICT DO NOTHING", [owner]);
    const { rows: [row] } = await db.query("SELECT * FROM neurotext_billing WHERE user_id=$1 FOR UPDATE", [owner]);
    if (row.access_status === "paid" && (!row.access_until || new Date(row.access_until).getTime() > Date.now())) throw new Error("Your account already has paid access.");
    let customer = row.stripe_customer_id;
    if (!customer) {
      const { rows: [user] } = await db.query("SELECT email FROM neurotext_users WHERE id=$1", [owner]);
      if (!user) throw new Error("Sign in with Google again.");
      customer = (await stripe.customers.create({ email: user.email, metadata: { neurotext_user_id: owner } }, { idempotencyKey: `neurotext-customer:${owner}` })).id;
      await db.query("UPDATE neurotext_billing SET stripe_customer_id=$2 WHERE user_id=$1", [owner, customer]);
    }
    if (row.stripe_checkout_id) {
      const existing = await stripe.checkout.sessions.retrieve(row.stripe_checkout_id);
      if (existing.status === "open" && existing.url) { await db.query("COMMIT"); return existing.url; }
      if (existing.status === "complete") {
        const subscriptionId = idOf(existing.subscription);
        const previous = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
        if (!previous || !["canceled", "incomplete_expired"].includes(previous.status)) {
          throw new Error("A checkout has already completed. Use Check payment status or Manage billing rather than paying twice.");
        }
      }
    }
    const origin = billingOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: price.type === "recurring" ? "subscription" : "payment", customer,
      client_reference_id: owner, metadata: { neurotext_user_id: owner },
      ...(price.type === "recurring" ? { subscription_data: { metadata: { neurotext_user_id: owner } } } : {}),
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    await db.query("UPDATE neurotext_billing SET stripe_checkout_id=$2,updated_at=now() WHERE user_id=$1", [owner, session.id]);
    await db.query("COMMIT");
    return session.url;
  } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
}

export async function processStripeEvent(event: Stripe.Event) {
  const object = event.data.object as any;
  let customer = idOf(object.customer);
  if (!customer && object.charge) customer = idOf((await stripeClient().charges.retrieve(idOf(object.charge)!)).customer);
  if (!customer) return;
  const { rows: [row] } = await pool.query("SELECT user_id FROM neurotext_billing WHERE stripe_customer_id=$1", [customer]);
  if (!row) return;
  // A retry is safe; refresh always reads current Stripe state, even when an
  // earlier delivered event is replayed after a cancellation or refund.
  await refreshBilling(row.user_id);
}
