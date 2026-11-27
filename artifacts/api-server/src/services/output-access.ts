import type { RequestHandler } from "express";
import { hasPaidAccess } from "./stripe-billing";

export const PREVIEW_NOTICE = "\n\n[Preview only — Google sign-in and payment are required for complete answers.]";
const words = (text: string) => text.trim() ? text.trim().split(/\s+/u) : [];

// Always apply this to new provider output, never trust a model-supplied marker.
export function previewAnswer(text: string, requestedWords = 0): string {
  const tokens = words(text);
  const long = Math.max(tokens.length, requestedWords) > 4000;
  const limit = long ? Math.min(500, Math.floor(tokens.length * 0.05)) : Math.floor(tokens.length / 2);
  let prefix = tokens.slice(0, limit).join(" ");
  if (!prefix && text.length > 1) prefix = text.slice(0, Math.floor(text.length / 2));
  return prefix + PREVIEW_NOTICE;
}

// Stored previews have already been shortened by the server. Do not halve them
// again on every autosave, reload, copy or account-history read.
export function visibleStoredAnswer(text: string, requestedWords = 0): string {
  if (!text) return text;
  return text.endsWith(PREVIEW_NOTICE) && words(text).length <= 2020 ? text : previewAnswer(text, requestedWords);
}
export function maskAnswerJson(value: any): any {
  if (Array.isArray(value)) return value.map(maskAnswerJson);
  if (!value || typeof value !== "object") return value;
  const result = { ...value };
  for (const [key, item] of Object.entries(result)) {
    if (["output", "text", "relevanceReport", "rewrittenDraft"].includes(key) && typeof item === "string") result[key] = visibleStoredAnswer(item, Number(result.targetWords) || 0);
    else if (key === "reportProof") result[key] = "";
    else if (key === "skeleton") result[key] = "";
    else if (item && typeof item === "object") result[key] = maskAnswerJson(item);
  }
  return result;
}

declare global { namespace Express { interface Request { fullAnswerAccess?: boolean } } }
export const answerAccess: RequestHandler = async (req, res, next) => {
  try {
    req.fullAnswerAccess = await hasPaidAccess(req.session?.userId);
    if (!req.fullAnswerAccess) {
      const json = res.json.bind(res);
      res.json = body => json(res.statusCode < 400 ? maskAnswerJson(body) : body);
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (error) { next(error); }
};
