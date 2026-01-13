import { storage } from "../storage";
import { hasUnlimitedCredits as checkUnlimited } from "../lib/stripe-config";

export const CREDIT_COSTS: Record<string, number> = {
  deepseek: 1,
  grok: 20,
  perplexity: 20,
  openai: 25,
  anthropic: 35,
  claude: 35,
};

export async function checkAndDeductCredits(
  userId: number | undefined,
  username: string | undefined,
  provider: string
): Promise<{ success: boolean; error?: string; creditsDeducted?: number }> {
  if (!userId) {
    return { success: false, error: "User not authenticated" };
  }

  if (checkUnlimited(username)) {
    return { success: true, creditsDeducted: 0 };
  }

  const normalizedProvider = provider.toLowerCase();
  const cost = CREDIT_COSTS[normalizedProvider] || CREDIT_COSTS.openai;

  const totalCredits = await storage.getTotalUserCredits(userId);

  if (totalCredits < cost) {
    return {
      success: false,
      error: `Insufficient credits. You have ${totalCredits} credits but need ${cost} for ${provider}. Please buy more credits.`,
    };
  }

  const deducted = await storage.deductCredits(userId, "stripe", cost);
  
  if (!deducted) {
    return {
      success: false,
      error: `Failed to deduct credits. Please try again or contact support.`,
    };
  }

  console.log(`[CreditManager] Deducted ${cost} credits for ${provider} from user ${userId}`);
  return { success: true, creditsDeducted: cost };
}

export function getCreditCost(provider: string): number {
  const normalizedProvider = provider.toLowerCase();
  return CREDIT_COSTS[normalizedProvider] || CREDIT_COSTS.openai;
}

export { checkUnlimited as hasUnlimitedCredits };
