import type { AppErrorData, AppResult } from "../../shared/contracts";

export class RendererAppError extends Error {
  constructor(readonly data: AppErrorData) {
    super(data.message);
    this.name = "RendererAppError";
  }
}

export const unwrap = <T>(result: unknown): T => {
  const candidate = result as AppResult<T>;
  if (!candidate || typeof candidate !== "object" || !("ok" in candidate)) {
    throw new RendererAppError({
      kind: "UNKNOWN",
      code: "INVALID_MAIN_RESPONSE",
      message: "The desktop service returned an invalid response.",
      retryable: true,
    });
  }
  if (candidate.ok === false) throw new RendererAppError(candidate.error);
  return candidate.data;
};

export const errorData = (error: unknown): AppErrorData =>
  error instanceof RendererAppError
    ? error.data
    : {
        kind: "UNKNOWN",
        code: "RENDERER_ERROR",
        message: error instanceof Error ? error.message : "Unexpected interface error",
        retryable: true,
      };
