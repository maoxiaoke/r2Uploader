import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ObjectListPage } from "../shared/contracts";
import { isConfirmedEmptyListing, mergeObjectPages } from "../shared/object-listing";

const page = (input: Partial<ObjectListPage>): ObjectListPage => ({ objects: [], folders: [], hasMore: false, syncedAt: new Date(0).toISOString(), source: "remote", ...input });

describe("GitHub Issues #2 and #3 object-list regressions", () => {
  it("never labels a folder-only bucket as empty", () => {
    expect(isConfirmedEmptyListing(page({ folders: ["assets/"] }), [], false, false)).toBe(false);
  });

  it("preserves objects and folders while appending paginated results", () => {
    const first = page({ objects: [{ key: "one.txt", displayName: "one.txt", size: 1, access: "private" }], folders: ["a/"], hasMore: true, cursor: "next" });
    const second = page({ objects: [{ key: "two.txt", displayName: "two.txt", size: 2, access: "private" }], folders: ["b/"] });
    const merged = mergeObjectPages(first, second, true);
    expect(merged.objects.map((item) => item.key)).toEqual(["one.txt", "two.txt"]);
    expect(merged.folders).toEqual(["a/", "b/"]);
  });

  it("keeps failures and loading separate from a real empty state", () => {
    expect(isConfirmedEmptyListing(page({}), [], false, true)).toBe(false);
    expect(isConfirmedEmptyListing(page({}), [], true, false)).toBe(false);
    expect(isConfirmedEmptyListing(page({}), [], false, false)).toBe(true);
  });
});

describe("GitHub Issue #5 layout and window regressions", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "renderer/styles/globals.css"), "utf8");
  const shell = fs.readFileSync(path.join(process.cwd(), "renderer/components/new/app-shell.tsx"), "utf8");

  it("uses a wrapping responsive folder/object grid", () => {
    expect(css).toMatch(/\.object-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,/);
  });

  it("retains an explicit draggable title region and non-draggable controls", () => {
    expect(shell).toContain("window-drag");
    expect(shell).toContain("window-no-drag");
  });
});
