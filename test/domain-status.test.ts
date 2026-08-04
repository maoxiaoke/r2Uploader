import { describe, expect, it } from "vitest";
import { isDomainReady, isUsableDomain } from "../shared/domain-status";

describe("custom domain readiness", () => {
  it("does not generate links while ownership or SSL is pending", () => {
    const pending = { type: "custom" as const, domain: "assets.example.com", enabled: true, ownership: "active", ssl: "pending" };
    expect(isDomainReady(pending)).toBe(false);
    expect(isUsableDomain(pending)).toBe(false);
  });

  it("requires both readiness and explicit enablement", () => {
    const disabled = { type: "custom" as const, domain: "assets.example.com", enabled: false, ownership: "active", ssl: "active" };
    expect(isDomainReady(disabled)).toBe(true);
    expect(isUsableDomain(disabled)).toBe(false);
    expect(isUsableDomain({ ...disabled, enabled: true })).toBe(true);
  });

  it("treats managed domains as ready but still honors enabled", () => {
    expect(isUsableDomain({ type: "managed", domain: "example.r2.dev", enabled: true })).toBe(true);
    expect(isUsableDomain({ type: "managed", domain: "example.r2.dev", enabled: false })).toBe(false);
  });
});
