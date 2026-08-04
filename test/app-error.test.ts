import { describe, expect, it } from "vitest";
import { errorFromResponse, redact, toAppError } from "../main/core/app-error";

describe("typed and redacted errors", () => {
  it("maps authentication and retryable server responses", () => {
    expect(errorFromResponse(401, "bad token").data.kind).toBe("AUTHENTICATION");
    expect(errorFromResponse(503, "down").data.retryable).toBe(true);
  });

  it("preserves request IDs without preserving secrets", () => {
    const problem = errorFromResponse(403, "permission denied", { requestId: "ray-123" }).data;
    expect(problem.requestId).toBe("ray-123");
    expect(problem.kind).toBe("PERMISSION");
  });

  it("redacts bearer tokens and named secrets", () => {
    const message = redact("Authorization: Bearer abc.DEF-123 token=super-secret secret:xyz");
    expect(message).not.toContain("abc.DEF-123");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("xyz");
  });

  it("maps network failures to retryable network errors", () => {
    const problem = toAppError(Object.assign(new Error("offline"), { code: "ENOTFOUND" }));
    expect(problem.kind).toBe("NETWORK");
    expect(problem.retryable).toBe(true);
  });
});
