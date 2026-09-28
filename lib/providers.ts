import "server-only";
import { HttpError } from "./server-auth";
import { generateFeedback as callProvider, ProviderError } from "./provider-client";
export { providerEndpoint, estimatedTextCostCny, estimatedAsrCostCny } from "./provider-client";

export async function generateFeedback(...args: Parameters<typeof callProvider>) {
  try { return await callProvider(...args); }
  catch (error) {
    if (error instanceof ProviderError) throw new HttpError(error.status, error.message);
    throw new HttpError(502, "AI provider unavailable. Your answer is retained.");
  }
}
