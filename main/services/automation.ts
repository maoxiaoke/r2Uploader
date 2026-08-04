import { clipboard, Notification } from "electron";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AutomationRule, AutomationRunRecord } from "../../shared/contracts";
import { isUsableDomain } from "../../shared/domain-status";
import { encodeObjectKey } from "./cloudflare-client";
import { getBootstrapState, type ProfileCredentials } from "./config-vault";
import { readJson, writeJson } from "./json-store";
import { copyOrMoveObject } from "./object-operations";
import { R2ObjectService } from "./r2-object-service";

const FILE = "automation-rules.json";
const RUNS_FILE = "automation-runs.json";
const eventIdFor = (profileId: string, bucket: string, key: string, version: string) => createHash("sha256").update(`${profileId}\0${bucket}\0${key}\0${version}`).digest("hex");
const updateRun = (eventId: string, ruleId: string, bucket: string, key: string, update: (run: AutomationRunRecord) => void) => {
  const runs = readJson<AutomationRunRecord[]>(RUNS_FILE, []);
  const current = runs.find((run) => run.eventId === eventId && run.ruleId === ruleId) ?? { eventId, ruleId, bucket, key, actions: [], failures: [], updatedAt: "" };
  current.bucket = bucket;
  current.key = key;
  current.failures = current.failures ?? [];
  update(current);
  current.updatedAt = new Date().toISOString();
  writeJson(RUNS_FILE, [current, ...runs.filter((run) => run.eventId !== eventId || run.ruleId !== ruleId)].slice(0, 10_000));
};
const markAction = (eventId: string, ruleId: string, action: string, bucket: string, key: string) => updateRun(eventId, ruleId, bucket, key, (current) => {
  if (!current.actions.includes(action)) current.actions.push(action);
});
const markFailure = (eventId: string, ruleId: string, failure: string, bucket: string, key: string) => updateRun(eventId, ruleId, bucket, key, (current) => { if (!current.failures.includes(failure)) current.failures.push(failure); });
export const listAutomationRules = (profileId?: string) => readJson<AutomationRule[]>(FILE, []).filter((rule) => !profileId || rule.profileId === profileId);
export const listAutomationRuns = (profileId?: string) => {
  const ruleIds = new Set(listAutomationRules(profileId).map((rule) => rule.id));
  return readJson<AutomationRunRecord[]>(RUNS_FILE, []).map((run) => ({ ...run, failures: run.failures ?? [] })).filter((run) => !profileId || ruleIds.has(run.ruleId)).slice(0, 500);
};
export const saveAutomationRule = (input: Omit<AutomationRule, "id" | "createdAt" | "updatedAt"> & { id?: string }) => {
  const items = readJson<AutomationRule[]>(FILE, []);
  const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
  const now = new Date().toISOString();
  const rule: AutomationRule = { ...input, id: existing?.id ?? randomUUID(), prefix: input.prefix.replace(/^\/+/, ""), createdAt: existing?.createdAt ?? now, updatedAt: now };
  writeJson(FILE, [rule, ...items.filter((item) => item.id !== rule.id)]);
  return rule;
};
export const deleteAutomationRule = (id: string) => { writeJson(FILE, readJson<AutomationRule[]>(FILE, []).filter((rule) => rule.id !== id)); return true; };

const publicUrl = async (service: R2ObjectService, bucket: string, key: string) => {
  const info = (await service.listBuckets()).find((item) => item.name === bucket);
  const preferred = getBootstrapState().preferences.defaultShareDomains[`${service.profile.id}:${bucket}`];
  const domain = info?.domains.find((item) => isUsableDomain(item) && item.domain === preferred) ?? info?.domains.find((item) => isUsableDomain(item) && item.type === "custom") ?? info?.domains.find((item) => isUsableDomain(item) && item.type === "managed");
  if (!domain) throw new Error("No public domain is enabled for the upload bucket.");
  return `https://${domain.domain}/${encodeObjectKey(key)}`;
};

export const executeUploadAutomations = async (profile: ProfileCredentials, bucket: string, key: string, version: string) => {
  const zh = getBootstrapState().preferences.locale === "zh-CN";
  const rules = listAutomationRules(profile.id).filter((rule) => rule.enabled && rule.bucket === bucket && key.startsWith(rule.prefix));
  const failures: string[] = [];
  const eventId = eventIdFor(profile.id, bucket, key, version);
  for (const rule of rules) {
    try {
      const completed = readJson<AutomationRunRecord[]>(RUNS_FILE, []).find((run) => run.eventId === eventId && run.ruleId === rule.id)?.actions ?? [];
      if (rule.copyToBucket && !completed.includes("copy")) {
        const targetKey = [rule.copyToPrefix?.replace(/^\/+|\/+$/g, ""), path.posix.basename(key)].filter(Boolean).join("/");
        await copyOrMoveObject(profile, { sourceBucket: bucket, sourceKey: key, targetBucket: rule.copyToBucket, targetKey, move: false, overwrite: false });
        markAction(eventId, rule.id, "copy", bucket, key);
      }
      if (rule.copyLink !== "none" && !completed.includes("link")) {
        const service = new R2ObjectService(profile);
        const url = rule.copyLink === "temporary" ? (await service.temporaryShare(bucket, key, rule.expiresInSeconds)).url : await publicUrl(service, bucket, key);
        clipboard.writeText(url);
        markAction(eventId, rule.id, "link", bucket, key);
      }
      if (rule.notify && !completed.includes("notify")) { if (Notification.isSupported()) new Notification({ title: `${zh ? "自动化" : "Automation"} · ${rule.name}`, body: zh ? `已完成：r2://${bucket}/${key}` : `Completed for r2://${bucket}/${key}` }).show(); markAction(eventId, rule.id, "notify", bucket, key); }
    } catch (error) { const failure = `${rule.name}: ${error instanceof Error ? error.message : String(error)}`; failures.push(failure); markFailure(eventId, rule.id, failure, bucket, key); }
  }
  return { matched: rules.length, failures };
};
