import { describe, expect, it } from "vitest";
import type { ObjectListPage } from "../shared/contracts";
import { searchObjectKeys } from "../main/services/object-search";
import type { R2ObjectService } from "../main/services/r2-object-service";

const makePage = (keys: string[], cursor?: string): ObjectListPage => ({ objects: keys.map((key) => ({ key, displayName: key.split("/").pop() as string, size: 1, access: "private" })), folders: [], cursor, hasMore: Boolean(cursor), syncedAt: new Date(0).toISOString(), source: "remote" });

describe("full-bucket object search", () => {
  it("matches text anywhere in the key across pages", async () => {
    const pages = [makePage(["archive/readme.txt", "images/cover.webp"], "next"), makePage(["drafts/cover-dark.webp"])];
    const service = { listObjects: async () => pages.shift() as ObjectListPage } as unknown as R2ObjectService;
    const result = await searchObjectKeys(service, "assets", "COVER");
    expect(result.objects.map((item) => item.key)).toEqual(["images/cover.webp", "drafts/cover-dark.webp"]);
    expect(result.scannedObjects).toBe(3);
    expect(result.searchTruncated).toBe(false);
  });
});
