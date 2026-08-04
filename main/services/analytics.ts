import type { BucketAnalytics } from "../../shared/contracts";
import { AppError } from "../core/app-error";
import { CloudflareClient } from "./cloudflare-client";
import type { ProfileCredentials } from "./config-vault";

const PRICING = {
  updatedAt: "2026-05-28",
  source: "https://developers.cloudflare.com/r2/pricing/",
  storagePerGbMonth: 0.015,
  classAPerMillion: 4.5,
  classBPerMillion: 0.36,
  freeStorageGbMonth: 10,
  freeClassA: 1_000_000,
  freeClassB: 10_000_000,
};

const CLASS_A = new Set(["listbuckets", "putbucket", "listobjects", "putobject", "copyobject", "completemultipartupload", "createmultipartupload", "lifecyclestoragetiertransition", "listmultipartuploads", "uploadpart", "uploadpartcopy", "listparts", "putbucketencryption", "putbucketcors", "putbucketlifecycleconfiguration"]);
const CLASS_B = new Set(["headbucket", "headobject", "getobject", "usagesummary", "getbucketencryption", "getbucketlocation", "getbucketcors", "getbucketlifecycleconfiguration"]);
const FREE = new Set(["deleteobject", "deletebucket", "abortmultipartupload"]);
const pricingClass = (action: string): "A" | "B" | "free" | "unknown" => {
  const normalized = action.replace(/[^a-z]/gi, "").toLowerCase();
  return CLASS_A.has(normalized) ? "A" : CLASS_B.has(normalized) ? "B" : FREE.has(normalized) ? "free" : "unknown";
};

const QUERY = `
query R2UploaderAnalytics($accountTag: string!, $startDate: Time!, $endDate: Time!, $bucketName: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      operations: r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $startDate, datetime_leq: $endDate, bucketName: $bucketName }
      ) { sum { requests } dimensions { actionType } }
      storage: r2StorageAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $startDate, datetime_leq: $endDate, bucketName: $bucketName }
        orderBy: [datetime_DESC]
      ) { max { objectCount uploadCount payloadSize metadataSize } dimensions { datetime } }
    }
  }
}`;

interface AnalyticsResponse {
  viewer?: { accounts?: Array<{
    operations?: Array<{ sum?: { requests?: number | string }; dimensions?: { actionType?: string } }>;
    storage?: Array<{ max?: { objectCount?: number | string; payloadSize?: number | string; metadataSize?: number | string }; dimensions?: { datetime?: string } }>;
  }> };
}

export const getBucketAnalytics = async (profile: ProfileCredentials, bucket: string, days = 30): Promise<BucketAnalytics> => {
  if (!profile.apiToken) throw new AppError({ kind: "AUTHENTICATION", code: "API_TOKEN_REQUIRED_FOR_ANALYTICS", message: "Cloudflare Analytics requires an account API token.", action: "Add an API token with Account Analytics Read permission.", retryable: false });
  const safeDays = Math.max(1, Math.min(31, days));
  const to = new Date();
  const from = new Date(to.getTime() - safeDays * 86_400_000);
  const data = await new CloudflareClient(profile).graphql<AnalyticsResponse>(QUERY, {
    accountTag: profile.accountId,
    startDate: from.toISOString(),
    endDate: to.toISOString(),
    bucketName: bucket,
  });
  const account = data.viewer?.accounts?.[0];
  const storage = (account?.storage ?? []).map((row) => ({
    at: row.dimensions?.datetime ?? "",
    objectCount: Number(row.max?.objectCount ?? 0),
    payloadBytes: Number(row.max?.payloadSize ?? 0),
    metadataBytes: Number(row.max?.metadataSize ?? 0),
  })).filter((row) => row.at);
  const operations = (account?.operations ?? []).map((row) => {
    const actionType = row.dimensions?.actionType ?? "unknown";
    return { actionType, requests: Number(row.sum?.requests ?? 0), pricingClass: pricingClass(actionType) };
  });
  const current = storage[0] ?? { objectCount: 0, payloadBytes: 0, metadataBytes: 0 };
  const totalFor = (kind: "A" | "B" | "free" | "unknown") => operations.filter((item) => item.pricingClass === kind).reduce((sum, item) => sum + item.requests, 0);
  const totals = { objectCount: current.objectCount, storageBytes: current.payloadBytes + current.metadataBytes, classA: totalFor("A"), classB: totalFor("B"), free: totalFor("free"), unknown: totalFor("unknown") };
  const storageGb = totals.storageBytes / 1_000_000_000;
  const storageCost = Math.max(0, storageGb - PRICING.freeStorageGbMonth) * PRICING.storagePerGbMonth;
  const classACost = Math.max(0, totals.classA - PRICING.freeClassA) / 1_000_000 * PRICING.classAPerMillion;
  const classBCost = Math.max(0, totals.classB - PRICING.freeClassB) / 1_000_000 * PRICING.classBPerMillion;
  const oldest = storage.at(-1);
  const oldestBytes = oldest ? oldest.payloadBytes + oldest.metadataBytes : undefined;
  const storageGrowthBytes = oldestBytes === undefined ? undefined : totals.storageBytes - oldestBytes;
  const storageGrowthPercent = oldestBytes && storageGrowthBytes !== undefined ? storageGrowthBytes / oldestBytes * 100 : undefined;
  const abnormalStorageGrowth = Boolean(storageGrowthBytes !== undefined && storageGrowthBytes > Math.max(1_000_000_000, (oldestBytes ?? 0) * 0.25));
  return {
    bucket,
    from: from.toISOString(),
    to: to.toISOString(),
    fetchedAt: new Date().toISOString(),
    retentionDays: 31,
    dataMayLag: true,
    storage,
    operations,
    totals,
    estimate: {
      currency: "USD",
      amount: Number((storageCost + classACost + classBCost).toFixed(2)),
      note: `Estimate uses the latest Standard storage snapshot and operations observed in this ${safeDays}-day query. It is not an invoice; account-wide free-tier sharing, daily GB-month averaging, Infrequent Access, retrieval, taxes, and delayed analytics can change actual billing.`,
      pricingUpdatedAt: PRICING.updatedAt,
      pricingSource: PRICING.source,
      freeTier: { storageGbMonth: PRICING.freeStorageGbMonth, classA: PRICING.freeClassA, classB: PRICING.freeClassB },
      breakdown: { storage: Number(storageCost.toFixed(4)), classA: Number(classACost.toFixed(4)), classB: Number(classBCost.toFixed(4)), internetEgress: 0 },
    },
    insights: { storageGrowthBytes, storageGrowthPercent, abnormalStorageGrowth, unknownRequests: totals.unknown, internetEgressPricedAtZero: true, retrievalUsageAvailable: false },
  };
};
