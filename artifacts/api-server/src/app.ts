import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyStripeWebhook } from "./services/stripe-direct";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cookieParser());
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.get("stripe-signature");
  if (!signature) {
    res.status(400).json({ error: "Missing Stripe signature." });
    return;
  }
  try {
    const event = verifyStripeWebhook(req.body as Buffer, signature);
    logger.info({ stripeEventId: event.id, stripeEventType: event.type }, "Verified Stripe webhook");
    res.json({ received: true });
  } catch (error) {
    logger.warn("Rejected Stripe webhook");
    res.status(400).json({ error: "Invalid Stripe webhook signature." });
  }
});
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
