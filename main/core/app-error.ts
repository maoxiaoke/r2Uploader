import type { AppErrorData, ErrorKind } from "../../shared/contracts";

const STATUS_KIND: Record<number, ErrorKind> = {
  400: "VALIDATION",
  401: "AUTHENTICATION",
  403: "PERMISSION",
  404: "NOT_FOUND",
  408: "TIMEOUT",
  409: "CONFLICT",
  429: "RATE_LIMIT",
};

export class AppError extends Error {
  readonly data: AppErrorData;

  constructor(data: AppErrorData) {
    super(data.message);
    this.name = "AppError";
    this.data = data;
  }
}

export const errorFromResponse = (
  status: number,
  message: string,
  options: Partial<AppErrorData> = {}
) =>
  new AppError({
    kind: STATUS_KIND[status] ?? (status >= 500 ? "UNAVAILABLE" : "UNKNOWN"),
    code: options.code ?? `HTTP_${status}`,
    message,
    status,
    requestId: options.requestId,
    retryable: options.retryable ?? (status === 408 || status === 429 || status >= 500),
    action: options.action,
    details: options.details,
  });

export const toAppError = (error: unknown): AppErrorData => {
  if (error instanceof AppError) return error.data;

  const candidate = error as {
    name?: string;
    message?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number; requestId?: string };
  };
  const status = candidate?.$metadata?.httpStatusCode;
  const code = candidate?.code ?? candidate?.name ?? "UNKNOWN";
  const network = ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code);
  const timeout = code === "AbortError" || code === "ETIMEDOUT";

  return {
    kind: timeout
      ? "TIMEOUT"
      : network
        ? "NETWORK"
        : status
          ? STATUS_KIND[status] ?? (status >= 500 ? "UNAVAILABLE" : "UNKNOWN")
          : "UNKNOWN",
    code,
    message: redact(candidate?.message || "Unexpected application error"),
    status,
    requestId: candidate?.$metadata?.requestId,
    retryable: timeout || network || status === 429 || Boolean(status && status >= 500),
  };
};

export const redact = (value: string) =>
  value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|license)([\s=:"']+)[^\s,"'}]+/gi, "$1$2[REDACTED]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[REDACTED]");
