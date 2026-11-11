import { Router, type IRouter } from "express";
import healthRouter from "./health";
import neurotextRouter from "./neurotext";
import documentExtractionRouter from "./document-extraction";

const router: IRouter = Router();

router.use(healthRouter);
router.use(neurotextRouter);
router.use(documentExtractionRouter);

export default router;
