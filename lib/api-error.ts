/** Carries the server response while remaining compatible with existing Error handlers. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `请求失败 / Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}
