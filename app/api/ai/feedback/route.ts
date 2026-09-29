import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptKey } from "@/lib/key-crypto";
import { reserveBudget, settleBudget } from "@/lib/ai-budget";
import { estimatedTextCostCny, generateFeedback, feedbackInputTokenEstimate, FeedbackRequestError } from "@/lib/providers";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Input = z.object({ skill: z.enum(["writing", "speaking"]), prompt: z.string().min(1).max(30000), answer: z.string().min(1).max(100000), overrideBudget: z.boolean().default(false) });
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    if (!profile.ai_enabled) throw new HttpError(403, "AI is disabled");
    const input = Input.parse(await request.json());
    const { data: config, error } = await admin.from("provider_keys").select("*").eq("owner_id", userId).eq("kind", "text").maybeSingle();
    if (error) throw error;
    if (!config) throw new HttpError(400, "Set a text provider key first");
    let key: string;
    try { key = decryptKey(config.encrypted_key, config.iv); }
    catch { throw new HttpError(503, profile.language === "zh" ? "无法解密已保存密钥，请重新保存密钥或联系维护者检查加密配置。" : "The saved key could not be decrypted. Save it again or check server encryption configuration."); }
    const preflight = estimatedTextCostCny(config.provider, feedbackInputTokenEstimate(input.prompt, input.answer, profile.language), 1200);
    const reservation = await reserveBudget(admin, userId, config.provider, `${input.skill}_feedback`, preflight, input.overrideBudget);
    let generated;
    try {
      generated = await generateFeedback(config.provider, config.workspace_id, key, input.skill, input.prompt, input.answer, profile.language);
    } catch (error) {
      // A timed-out provider may still bill the request; keep a conservative estimate.
      await settleBudget(admin, reservation.id, error instanceof FeedbackRequestError && !error.possiblyBilled ? 0 : preflight);
      throw error;
    }
    const { feedback, inputTokens, outputTokens } = generated;
    const estimated = estimatedTextCostCny(config.provider, inputTokens, outputTokens);
    await settleBudget(admin, reservation.id, estimated);
    return NextResponse.json({ feedback, estimatedCny: estimated, budgetNearlyUsed: reservation.used + estimated >= Number(profile.monthly_budget_cny) * 0.8 });
  } catch (error) { return apiError(error); }
}
