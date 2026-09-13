import { Router, type IRouter } from "express";
import healthRouter from "./health";
import neurotextRouter from "./neurotext";

const router: IRouter = Router();

router.use(healthRouter);
router.use(neurotextRouter);

export default router;
