import { Router, type IRouter } from "express";
import healthRouter from "./health";
import neurotextRouter from "./neurotext";
import documentExtractionRouter from "./document-extraction";
import accountsRouter from "./accounts";
import libraryRouter from "./library";
import wordRouter from "./word-extraction";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountsRouter);
router.use(libraryRouter);
router.use(wordRouter);
router.use(neurotextRouter);
router.use(documentExtractionRouter);

export default router;
