import { Router, type IRouter } from "express";
import { getAuthenticatedUser, hasPermanentOwnerAccess } from "./auth";
import { findStripeCustomer, getStripeBillingStatus, stripeClient, subscriptionPriceId } from "../services/stripe-direct";

const stripeRouter: IRouter = Router();

function appOrigin(req: import("express").Request) {
  if (process.env.NODE_ENV === "production") return "https://neurotext.uk";
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new Error("Application origin is unavailable.");
  return `${protocol}://${host}`;
}

stripeRouter.get("/plan", async (req, res) => {
  try {
    const stripe = stripeClient();
    const price = await stripe.prices.retrieve(subscriptionPriceId(), { expand: ["product"] });
    const product = typeof price.product === "string" || price.product.deleted ? null : price.product;
    res.json({
      active: price.active,
      amount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring?.interval ?? null,
      name: product?.name ?? "NEUROTEXT unlimited subscription",
      description: product?.description ?? "",
    });
  } catch (error) {
    req.log.error({ error }, "Stripe plan failed");
    res.status(503).json({ error: "Subscription information is temporarily unavailable." });
  }
});

stripeRouter.get("/status", async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.json({ authenticated: false, active: false });
    return;
  }
  if (hasPermanentOwnerAccess(user)) {
    res.json({ authenticated: true, active: true, ownerAccess: true, permanent: true });
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    res.json({ authenticated: true, active: false, developmentUnlimited: true, latestPayment: null });
    return;
  }
  try {
    res.json({ authenticated: true, ...(await getStripeBillingStatus(user.email)) });
  } catch (error) {
    req.log.error({ error }, "Stripe status failed");
    res.status(503).json({ error: "Subscription status is temporarily unavailable." });
  }
});

stripeRouter.post("/checkout", async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in with Google before subscribing." });
    return;
  }
  if (hasPermanentOwnerAccess(user)) {
    res.status(409).json({ error: "Permanent owner access is already active." });
    return;
  }
  try {
    const stripe = stripeClient();
    const customer = await findStripeCustomer(user.email);
    const origin = appOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customer ? { customer: customer.id } : { customer_email: user.email }),
      line_items: [{ price: subscriptionPriceId(), quantity: 1 }],
      client_reference_id: user.id,
      metadata: { neurotextUserId: user.id },
      subscription_data: { metadata: { neurotextUserId: user.id } },
      allow_promotion_codes: true,
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ error }, "Stripe checkout failed");
    res.status(503).json({ error: "Checkout is temporarily unavailable." });
  }
});

stripeRouter.post("/portal", async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in with Google to manage billing." });
    return;
  }
  try {
    const customer = await findStripeCustomer(user.email);
    if (!customer) {
      res.status(404).json({ error: "No Stripe customer exists for this account." });
      return;
    }
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customer.id,
      return_url: appOrigin(req),
    });
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ error }, "Stripe portal failed");
    res.status(503).json({ error: "Billing management is temporarily unavailable." });
  }
});

export default stripeRouter;