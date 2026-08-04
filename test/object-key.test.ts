import { describe, expect, it } from "vitest";
import { encodeObjectKey, encodePathSegment } from "../main/services/cloudflare-client";
import { normalizeObjectKey } from "../main/core/object-key";

describe("R2 object key handling", () => {
  it("encodes every key segment while preserving directory slashes", () => {
    expect(encodeObjectKey("中文 目录/#file?x=1&y=2%.png")).toBe(
      "%E4%B8%AD%E6%96%87%20%E7%9B%AE%E5%BD%95/%23file%3Fx%3D1%26y%3D2%25.png"
    );
  });

  it("encodes bucket and account path segments independently", () => {
    expect(encodePathSegment("bucket?name#part")).toBe("bucket%3Fname%23part");
  });

  it("normalizes Windows separators without changing Unicode", () => {
    expect(normalizeObjectKey("截图\\2026\\夏天 🌤.png")).toBe("截图/2026/夏天 🌤.png");
  });

  it.each(["", "folder//file", "folder/../secret", "folder/./file"])(
    "rejects unsafe key %j",
    (key) => expect(() => normalizeObjectKey(key)).toThrow()
  );

  it("enforces the S3 1024-byte key limit", () => {
    expect(() => normalizeObjectKey("界".repeat(342))).toThrow(/1,024-byte/);
  });
});
