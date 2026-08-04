import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("product requirement source", () => {
  const report = fs.readFileSync(path.resolve("R2UPLOADER_REQUIREMENTS_DETAIL.md"), "utf8");
  const traceability = fs.readFileSync(path.resolve("docs/REQUIREMENTS_TRACEABILITY.md"), "utf8");
  const ids = [...report.matchAll(/^## (P[0-3]-\d{2}) /gm)].map((match) => match[1]);

  it("contains exactly the approved 58 non-team requirements", () => {
    expect(ids).toHaveLength(58);
    expect(new Set(ids).size).toBe(58);
    expect(ids.filter((id) => id.startsWith("P0-"))).toHaveLength(17);
    expect(ids.filter((id) => id.startsWith("P1-"))).toHaveLength(20);
    expect(ids.filter((id) => id.startsWith("P2-"))).toHaveLength(15);
    expect(ids.filter((id) => id.startsWith("P3-"))).toHaveLength(6);
  });

  it("keeps team RBAC outside the approved roadmap", () => {
    expect(report).toContain("团队工作区、成员管理、RBAC 和团队审计已经明确移出正式路线图");
  });

  it("maps every approved requirement to code evidence and live acceptance", () => {
    for (const id of ids) expect(traceability).toMatch(new RegExp(`\\| ${id} \\|`));
    expect(traceability).toContain("代码存在和本地 build 通过，不等于真实云端");
    expect(traceability).toContain("团队工作区、成员管理、RBAC 和团队审计不在这 58 项内");
  });

  it("keeps release, protocol, and local recovery safeguards explicit", () => {
    const builder = fs.readFileSync(path.resolve("electron-builder.config.cjs"), "utf8");
    const release = fs.readFileSync(path.resolve(".github/workflows/release.yml"), "utf8");
    const background = fs.readFileSync(path.resolve("main/background.ts"), "utf8");
    const ipc = fs.readFileSync(path.resolve("main/ipc/register.ts"), "utf8");
    const transfer = fs.readFileSync(path.resolve("main/services/transfer-manager.ts"), "utf8");
    const backup = fs.readFileSync(path.resolve("main/services/backup-manager.ts"), "utf8");
    expect(builder).toContain('schemes: ["r2uploader"]');
    expect(builder).toContain('from: "cli/r2uploader-cli.mjs"');
    expect(builder).toContain('"**/node_modules/sharp/**/*"');
    expect(builder).toContain('"**/node_modules/@img/**/*"');
    expect(background).toContain('fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))');
    expect(ipc).toContain('fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))');
    expect(builder).toContain('arch: ["x64", "arm64"]');
    expect(builder).toContain('target: [{ target: "nsis", arch: ["x64"] }]');
    expect(release).toContain('RELEASE_BUILD: "true"');
    expect(transfer).toContain('item.status === "queued" && !this.inFlight.has(item.id)');
    expect(transfer).toContain('if (!transfer.cleanupSource || !transfer.sourcePath) return;');
    expect(backup).toContain("BACKUP_OBJECT_INTEGRITY_FAILED");
  });

  it("keeps the Tailwind pipeline enabled for production renderer builds", () => {
    const nextConfig = fs.readFileSync(path.resolve("renderer/next.config.js"), "utf8");
    const postcss = fs.readFileSync(path.resolve("renderer/postcss.config.js"), "utf8");
    const globals = fs.readFileSync(path.resolve("renderer/styles/globals.css"), "utf8");
    expect(nextConfig).not.toContain("useLightningcss");
    expect(postcss).toContain("@tailwindcss/postcss");
    expect(globals).toContain('@import "tailwindcss"');
    expect(globals).toContain('@source "../../node_modules/@openai/apps-sdk-ui"');
  });

  it("keeps the later product safeguards represented in their owning code paths", () => {
    const transfer = fs.readFileSync(path.resolve("main/services/transfer-manager.ts"), "utf8");
    const protocol = fs.readFileSync(path.resolve("main/services/protocol-handler.ts"), "utf8");
    const history = fs.readFileSync(path.resolve("main/services/operation-history.ts"), "utf8");
    const vault = fs.readFileSync(path.resolve("main/services/config-vault.ts"), "utf8");
    const localFiles = fs.readFileSync(path.resolve("main/services/local-file-registry.ts"), "utf8");
    const planner = fs.readFileSync(path.resolve("main/services/upload-planner.ts"), "utf8");
    const domainStatus = fs.readFileSync(path.resolve("shared/domain-status.ts"), "utf8");
    expect(transfer).toContain("enqueueRemote(input:");
    expect(transfer).toContain("shell.openPath");
    expect(protocol).toContain('url.searchParams.get("v") !== "1"');
    expect(history).toContain("OPERATION_HISTORY_RETENTION_DAYS = 90");
    expect(history).toContain("const LIMIT = 2_000");
    expect(vault).toContain('syncTasks: readJson<SyncTask[]>("sync-tasks.json"');
    expect(vault).toContain("importedSecrets.apiToken ?? existing.secrets.apiToken");
    expect(vault).toContain("enabled: false");
    expect(localFiles).toContain('entry.name === ".DS_Store"');
    expect(localFiles).toContain("entry.isSymbolicLink()");
    expect(planner).toContain("processingWarning = toAppError(error).message");
    expect(planner).toContain("fs.rmSync(directory, { recursive: true, force: true })");
    expect(domainStatus).toContain("ready(domain.ownership) && ready(domain.ssl)");
  });
});
