import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import authRouter, { enforceFreeUsage, ensureVisitor } from "./auth";
import stripeRouter from "./stripe";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ensureVisitor);
router.use("/auth", authRouter);
router.use("/stripe", stripeRouter);
router.use(enforceFreeUsage, workspaceRouter);

export default router;
