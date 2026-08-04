import { AppError } from "./app-error";

export const normalizeObjectKey = (value: string) => {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new AppError({
      kind: "VALIDATION",
      code: "INVALID_OBJECT_KEY",
      message: "The object key contains an empty or unsafe path segment.",
      action: "Choose a name without leading slashes, '..', or empty folders.",
      retryable: false,
    });
  }
  if (new TextEncoder().encode(normalized).length > 1_024) {
    throw new AppError({
      kind: "VALIDATION",
      code: "OBJECT_KEY_TOO_LONG",
      message: "The object key is longer than the 1,024-byte S3 limit.",
      retryable: false,
    });
  }
  return normalized;
};
