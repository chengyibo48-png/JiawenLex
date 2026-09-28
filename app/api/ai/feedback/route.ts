import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptKey } from "@/lib/key-crypto";
import { checkBudget } from "@/lib/ai-budget";
import { estimatedTextCostCny, generateFeedback } from "@/lib/providers";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Input = z.object({ skill: z.enum(["writing", "speaking"]), prompt: z.string().min(1).max(30000), answer: z.string().min(1).max(100000), overrideBudget: z.boolean().default(false) });

export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    if (!profile.ai_enabled) throw new HttpError(403, "AI is disabled");
    const input = Input.parse(await request.json());
    const { data: config, error } = await admin.from("provider_keys").select("*").eq("owner_id", userId).eq("kind", "text").maybeSingle();
    if (error) throw error;
    if (!config) throw new HttpError(400, "Set a text provider key first");
    const preflight = estimatedTextCostCny(config.provider, Math.ceil((input.prompt.length + input.answer.length) / 2), 1200);
    const used = await checkBudget(admin, userId, profile.monthly_budget_cny, preflight, input.overrideBudget);
    const { feedback, inputTokens, outputTokens } = await generateFeedback(config.provider, config.workspace_id, decryptKey(config.encrypted_key, config.iv), input.skill, input.prompt, input.answer);
    const estimated = estimatedTextCostCny(config.provider, inputTokens, outputTokens);
    const { error: usageError } = await admin.from("ai_usage").insert({ owner_id: userId, provider: config.provider, operation: `${input.skill}_feedback`, estimated_cny: estimated });
    if (usageError) throw usageError;
    return NextResponse.json({ feedback, estimatedCny: estimated, budgetNearlyUsed: used + estimated >= Number(profile.monthly_budget_cny) * 0.8 });
  } catch (error) { return apiError(error); }
}
