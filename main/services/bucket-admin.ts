import dns from "node:dns/promises";
import tls from "node:tls";
import fetch from "node-fetch";
import type { CorsRule, DomainHealthResult, LifecycleRule } from "../../shared/contracts";
import { AppError } from "../core/app-error";
import { CloudflareClient } from "./cloudflare-client";
import type { ProfileCredentials } from "./config-vault";

const age = (days?: number) => days === undefined ? undefined : { type: "Age" as const, maxAge: Math.round(days * 86_400) };

export const getLifecycle = async (profile: ProfileCredentials, bucket: string): Promise<LifecycleRule[]> => {
  const result = await new CloudflareClient(profile).json<{ rules?: Array<{
    id: string;
    enabled: boolean;
    conditions?: { prefix?: string };
    deleteObjectsTransition?: { condition?: { type?: string; maxAge?: number } };
    abortMultipartUploadsTransition?: { condition?: { maxAge?: number } };
    storageClassTransitions?: Array<{ storageClass?: string; condition?: { maxAge?: number } }>;
  }> }>(new CloudflareClient(profile).bucketPath(bucket, "/lifecycle"));
  return (result.rules ?? []).map((rule) => ({
    id: rule.id,
    prefix: rule.conditions?.prefix ?? "",
    enabled: rule.enabled,
    deleteAfterDays: rule.deleteObjectsTransition?.condition?.maxAge === undefined ? undefined : rule.deleteObjectsTransition.condition.maxAge / 86_400,
    abortMultipartAfterDays: rule.abortMultipartUploadsTransition?.condition?.maxAge === undefined ? undefined : rule.abortMultipartUploadsTransition.condition.maxAge / 86_400,
    transitionToInfrequentAfterDays: rule.storageClassTransitions?.find((item) => item.storageClass === "InfrequentAccess")?.condition?.maxAge === undefined ? undefined : Number(rule.storageClassTransitions?.find((item) => item.storageClass === "InfrequentAccess")?.condition?.maxAge) / 86_400,
  }));
};

export const setLifecycle = async (profile: ProfileCredentials, bucket: string, rules: LifecycleRule[]) => {
  const client = new CloudflareClient(profile);
  await client.json(client.bucketPath(bucket, "/lifecycle"), {
    method: "PUT",
    body: JSON.stringify({ rules: rules.map((rule) => ({
      id: rule.id,
      conditions: { prefix: rule.prefix },
      enabled: rule.enabled,
      ...(rule.deleteAfterDays !== undefined ? { deleteObjectsTransition: { condition: age(rule.deleteAfterDays) } } : {}),
      ...(rule.abortMultipartAfterDays !== undefined ? { abortMultipartUploadsTransition: { condition: age(rule.abortMultipartAfterDays) } } : {}),
      ...(rule.transitionToInfrequentAfterDays !== undefined ? { storageClassTransitions: [{ storageClass: "InfrequentAccess", condition: age(rule.transitionToInfrequentAfterDays) }] } : {}),
    })) }),
  });
  return getLifecycle(profile, bucket);
};

export const getCors = async (profile: ProfileCredentials, bucket: string): Promise<CorsRule[]> => {
  const client = new CloudflareClient(profile);
  const result = await client.json<{ rules?: Array<{ id?: string; allowed?: { origins?: string[]; methods?: CorsRule["methods"]; headers?: string[] }; exposeHeaders?: string[]; maxAgeSeconds?: number }> }>(client.bucketPath(bucket, "/cors"));
  return (result.rules ?? []).map((rule) => ({ id: rule.id, origins: rule.allowed?.origins ?? [], methods: rule.allowed?.methods ?? [], headers: rule.allowed?.headers, exposeHeaders: rule.exposeHeaders, maxAgeSeconds: rule.maxAgeSeconds }));
};

export const setCors = async (profile: ProfileCredentials, bucket: string, rules: CorsRule[]) => {
  const client = new CloudflareClient(profile);
  if (!rules.length) {
    await client.raw(client.bucketPath(bucket, "/cors"), { method: "DELETE" });
    return [];
  }
  await client.json(client.bucketPath(bucket, "/cors"), {
    method: "PUT",
    body: JSON.stringify({ rules: rules.map((rule) => ({ id: rule.id, allowed: { origins: rule.origins, methods: rule.methods, headers: rule.headers }, exposeHeaders: rule.exposeHeaders, maxAgeSeconds: rule.maxAgeSeconds })) }),
  });
  return getCors(profile, bucket);
};

export const checkDomainHealth = async (url: string): Promise<DomainHealthResult> => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new AppError({ kind: "VALIDATION", code: "HTTPS_DOMAIN_REQUIRED", message: "Domain health checks only support HTTPS URLs.", retryable: false });
  const startedAt = Date.now();
  let dnsStatus: DomainHealthResult["dns"] = "skipped";
  try { await dns.lookup(parsed.hostname); dnsStatus = "ok"; } catch {
    return { url: parsed.toString(), checkedAt: new Date().toISOString(), dns: "failed", tls: "skipped", http: "failed", latencyMs: Date.now() - startedAt, detail: "DNS lookup failed, so TLS and HTTP were not attempted. Check the domain record and this device's network resolver." };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = tls.connect({ host: parsed.hostname, port: 443, servername: parsed.hostname, rejectUnauthorized: true, timeout: 10_000 }, () => { socket.end(); resolve(); });
      socket.once("error", reject);
      socket.once("timeout", () => { socket.destroy(); reject(new Error("TLS handshake timed out.")); });
    });
  } catch (error) {
    return { url: parsed.toString(), checkedAt: new Date().toISOString(), dns: dnsStatus, tls: "failed", http: "failed", latencyMs: Date.now() - startedAt, detail: `DNS resolved, but the trusted TLS handshake failed: ${error instanceof Error ? error.message : "unknown TLS error"}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(parsed, { method: "HEAD", redirect: "manual", signal: controller.signal });
    const healthy = response.status >= 200 && response.status < 400;
    return {
      url: parsed.toString(),
      checkedAt: new Date().toISOString(),
      dns: dnsStatus,
      tls: "ok",
      http: healthy ? "ok" : response.status === 401 || response.status === 403 || response.status === 404 ? "warning" : "failed",
      status: response.status,
      latencyMs: Date.now() - startedAt,
      cacheStatus: response.headers.get("cf-cache-status") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
      detail: healthy ? "DNS, TLS, and HTTP responded successfully." : `HTTPS responded with ${response.status}. A private or missing object can be expected; inspect public access and the tested key.`,
    };
  } catch (error) {
    return { url: parsed.toString(), checkedAt: new Date().toISOString(), dns: dnsStatus, tls: "ok", http: "failed", latencyMs: Date.now() - startedAt, detail: `DNS and TLS succeeded, but the HTTP request failed: ${error instanceof Error ? error.message : "unknown HTTP error"}` };
  } finally { clearTimeout(timer); }
};
