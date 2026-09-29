import { z } from "zod";
import { HttpError } from "./server-auth";

export const ExpectedProviderConfig = z.object({
  provider: z.enum(["deepseek", "qwen", "qwen-asr"]),
  workspaceId: z.string().max(80),
  updatedAt: z.string().datetime({ offset: true }),
});

// Pin the configuration that was shown in the data-sharing confirmation.
// Changes on another device must never silently switch the destination.
export function requireProviderConsent(
  expected: z.infer<typeof ExpectedProviderConfig> | undefined,
  current: { provider: string; workspace_id: string; updated_at: string },
  language: string,
) {
  if (!expected || expected.provider !== current.provider || expected.workspaceId !== current.workspace_id || Date.parse(expected.updatedAt) !== Date.parse(current.updated_at))
    throw new HttpError(409, language === "zh"
      ? "AI 配置已变化或页面需要更新。请刷新页面，重新确认服务商后提交；本次未发送学习内容。"
      : "AI configuration changed or this page is outdated. Refresh and confirm the provider again. No learning content was sent.");
}
