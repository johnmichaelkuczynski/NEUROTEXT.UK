import { Router, type IRouter, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import { SaveWorkspaceBody, SaveWorkspaceParams } from "@workspace/api-zod";
import { privateAccount, privateWrite, userId } from "../services/account-session";
import { billingConfigured, billingOrigin, configuredPrice, createCheckout, hasPaidAccess, processStripeEvent, refreshBilling, stripeClient } from "../services/stripe-billing";
import { maskAnswerJson } from "../services/output-access";

const router: IRouter = Router();
export const stripeWebhook: RequestHandler = async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
    res.status(503).json({ error: "Stripe webhook is not configured." }); return;
  }
  let event;
  try {
    const signature = req.get("stripe-signature");
    if (!signature || !Buffer.isBuffer(req.body)) throw new Error("Missing signed raw payload.");
    event = stripeClient().webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch { res.status(400).json({ error: "Invalid Stripe webhook signature." }); return; }
  try {
    if (/^(checkout\.session\.|customer\.subscription\.|invoice\.|charge\.|refund\.)/u.test(event.type)) await processStripeEvent(event);
    res.json({ received: true });
  } catch (error) {
    req.log.error({ err: error instanceof Error ? { message: error.message, stack: error.stack } : "Unknown error", eventType: event.type }, "Stripe webhook failed");
    res.status(500).json({ error: "Webhook processing failed; Stripe should retry." });
  }
};
router.get("/billing/status", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const fullAccess = await hasPaidAccess(userId(req));
  let price = null;
  let available = billingConfigured();
  if (available) {
    try {
      const p = await configuredPrice();
      price = { amount: p.unit_amount!, currency: p.currency, interval: p.recurring?.interval || null, intervalCount: p.recurring?.interval_count || 1 };
    } catch (error) { available = false; req.log.warn({ err: error }, "Stripe price unavailable"); }
  }
  res.json({ signedIn: Boolean(userId(req)), fullAccess, checkoutConfigured: available, price });
});
router.post("/billing/checkout", privateAccount, privateWrite, async (req, res): Promise<void> => {
  try { res.json({ url: await createCheckout(userId(req)!) }); }
  catch (error) { req.log.error({ err: error }, "Stripe checkout failed"); res.status(503).json({ error: error instanceof Error && !("type" in error) ? error.message : "Stripe checkout is unavailable. Please try again." }); }
});
router.post("/billing/confirm", privateAccount, privateWrite, async (req, res): Promise<void> => {
  const id = req.body?.sessionId;
  if (id !== undefined && (typeof id !== "string" || !/^cs_[A-Za-z0-9_]{1,250}$/u.test(id))) { res.status(400).json({ error: "Invalid checkout session." }); return; }
  try { res.json({ fullAccess: await refreshBilling(userId(req)!, id) }); }
  catch (error) { req.log.error({ err: error }, "Stripe payment verification failed"); res.status(409).json({ error: "Payment could not be verified for this Google account. No access was granted." }); }
});
router.post("/billing/portal", privateAccount, privateWrite, async (req, res): Promise<void> => {
  try {
    const { rows: [row] } = await pool.query("SELECT stripe_customer_id FROM neurotext_billing WHERE user_id=$1", [userId(req)]);
    if (!row?.stripe_customer_id) { res.status(404).json({ error: "No billing account exists yet." }); return; }
    const portal = await stripeClient().billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${billingOrigin()}/` });
    res.json({ url: portal.url });
  } catch (error) { req.log.error({ err: error }, "Stripe billing portal unavailable"); res.status(503).json({ error: "The billing portal is unavailable. Check your Stripe portal configuration." }); }
});
router.post("/billing/preserve", privateWrite, async (req, res): Promise<void> => {
  const params = SaveWorkspaceParams.safeParse({ functionId: req.body?.functionId });
  const body = SaveWorkspaceBody.safeParse(req.body?.workspace);
  if (!params.success || !body.success) { res.status(400).json({ error: "Could not preserve the current workspace. Your page has not been changed." }); return; }
  const draft = { functionId: params.data.functionId, workspace: await hasPaidAccess(userId(req)) ? body.data : maskAnswerJson(body.data) };
  if (userId(req)) {
    await persistPaymentDraft(userId(req)!, draft);
  } else {
    req.session.paymentDraft = draft;
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  }
  res.json({ ok: true });
});
export async function persistPaymentDraft(owner: string, draft: { functionId: number; workspace: unknown }) {
  await pool.query(`INSERT INTO neurotext_workspaces(session_id,function_id,payload) VALUES($1,$2,$3)
    ON CONFLICT(session_id,function_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,
    [`user:${owner}`, draft.functionId, JSON.stringify(draft.workspace)]);
}
export default router;
