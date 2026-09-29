import "server-only";
import { HttpError } from "./server-auth";
import { generateFeedback as callProvider, ProviderError } from "./provider-client";
import { providerFailureMessage } from "./provider-access";
export { providerEndpoint, estimatedTextCostCny, estimatedAsrCostCny, feedbackInputTokenEstimate } from "./provider-client";

export class FeedbackRequestError extends HttpError {
  possiblyBilled: boolean;
  constructor(status: number, message: string, possiblyBilled: boolean) {
    super(status, message); this.possiblyBilled = possiblyBilled;
  }
}

export async function generateFeedback(...args: Parameters<typeof callProvider>) {
  try { return await callProvider(...args); }
  catch (error) {
    const language = args[6] ?? "zh";
    const retained = language === "zh" ? " 原始作答仍保留，请稍后重试。" : " Your answer is retained. Please try again.";
    if (error instanceof ProviderError && error.upstreamStatus) throw new FeedbackRequestError(error.status, providerFailureMessage(error.upstreamStatus, language) + retained, !(error.upstreamStatus >= 400 && error.upstreamStatus < 500));
    if (error instanceof ProviderError) throw new FeedbackRequestError(error.status, (language === "zh" ? "AI 返回的反馈不完整或配置不可用。" : error.message) + retained, error.status >= 500);
    throw new FeedbackRequestError(502, providerFailureMessage(502, language) + retained, true);
  }
}
