import fetch, { type RequestInit, type Response } from "node-fetch";
import type { BucketItem, DomainStatus, Jurisdiction } from "../../shared/contracts";
import { AppError, errorFromResponse } from "../core/app-error";
import type { ProfileCredentials } from "./config-vault";

const API_ORIGIN = "https://api.cloudflare.com";
const API_PREFIX = "/client/v4";

export const encodePathSegment = (value: string) => encodeURIComponent(value);

export const encodeObjectKey = (key: string) =>
  key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const requestIdFrom = (response: Response) =>
  response.headers.get("cf-ray") ?? response.headers.get("x-request-id") ?? undefined;

const messageFromBody = (body: unknown, fallback: string) => {
  const candidate = body as { errors?: Array<{ message?: string }> };
  return candidate?.errors?.map((item) => item.message).filter(Boolean).join("; ") || fallback;
};

export class CloudflareClient {
  constructor(private readonly profile: ProfileCredentials) {}

  private get headers() {
    if (!this.profile.apiToken) {
      throw new AppError({
        kind: "AUTHENTICATION",
        code: "API_TOKEN_REQUIRED",
        message: "A Cloudflare API token is required for this account operation.",
        action: "Add an account API token to this connection profile.",
        retryable: false,
      });
    }
    return {
      Authorization: `Bearer ${this.profile.apiToken}`,
      "cf-r2-jurisdiction": this.profile.jurisdiction,
    };
  }

  private url(pathname: string, query?: Record<string, string | number | undefined>) {
    const url = new URL(`${API_PREFIX}${pathname}`, API_ORIGIN);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    });
    return url;
  }

  async raw(
    pathname: string,
    init: RequestInit = {},
    query?: Record<string, string | number | undefined>
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(this.url(pathname, query), {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.headers,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.clone().json();
        } catch {
          body = await response.clone().text();
        }
        throw errorFromResponse(response.status, messageFromBody(body, response.statusText), {
          requestId: requestIdFrom(response),
        });
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async json<T>(
    pathname: string,
    init: RequestInit = {},
    query?: Record<string, string | number | undefined>
  ): Promise<T> {
    const response = await this.raw(pathname, init, query);
    const body = (await response.json()) as {
      success?: boolean;
      result?: T;
      errors?: Array<{ code?: number; message?: string }>;
    };
    if (body.success === false) {
      throw new AppError({
        kind: "UNKNOWN",
        code: String(body.errors?.[0]?.code ?? "CLOUDFLARE_ERROR"),
        message: messageFromBody(body, "Cloudflare rejected the request."),
        requestId: requestIdFrom(response),
        retryable: false,
      });
    }
    return body.result as T;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(new URL("/client/v4/graphql", API_ORIGIN), {
        method: "POST",
        signal: controller.signal,
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const body = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
      if (!response.ok || body.errors?.length || !body.data) {
        throw errorFromResponse(response.status || 500, body.errors?.map((error) => error.message).filter(Boolean).join("; ") || "Cloudflare Analytics rejected the query.", { requestId: requestIdFrom(response) });
      }
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }

  accountPath(suffix = "") {
    return `/accounts/${encodePathSegment(this.profile.accountId)}/r2${suffix}`;
  }

  accountApiPath(suffix = "") {
    return `/accounts/${encodePathSegment(this.profile.accountId)}${suffix}`;
  }

  bucketPath(bucket: string, suffix = "") {
    return this.accountPath(`/buckets/${encodePathSegment(bucket)}${suffix}`);
  }

  objectPath(bucket: string, key?: string) {
    return this.bucketPath(bucket, `/objects${key === undefined ? "" : `/${encodeObjectKey(key)}`}`);
  }
}

interface CfBucket {
  name: string;
  creation_date?: string;
  jurisdiction?: Jurisdiction;
  location?: string;
}

interface ManagedDomain {
  domain: string;
  enabled: boolean;
  bucketId?: string;
}

interface CustomDomain {
  domain: string;
  enabled: boolean;
  status?: { ownership?: string; ssl?: string };
  zoneId?: string;
}

export const listBucketsWithDomains = async (profile: ProfileCredentials): Promise<BucketItem[]> => {
  const client = new CloudflareClient(profile);
  const result = await client.json<{ buckets?: CfBucket[] }>(client.accountPath("/buckets"));
  const buckets = result?.buckets ?? [];

  return Promise.all(
    buckets.map(async (bucket): Promise<BucketItem> => {
      const domains: DomainStatus[] = [];
      try {
        const managed = await client.json<ManagedDomain>(client.bucketPath(bucket.name, "/domains/managed"));
        if (managed?.domain) {
          domains.push({ domain: managed.domain, enabled: managed.enabled, type: "managed" });
        }
      } catch {
        // Domain permissions are optional; bucket browsing must still work.
      }
      try {
        const custom = await client.json<{ domains?: CustomDomain[] }>(
          client.bucketPath(bucket.name, "/domains/custom")
        );
        for (const domain of custom?.domains ?? []) {
          domains.push({
            domain: domain.domain,
            enabled: domain.enabled,
            type: "custom",
            ownership: domain.status?.ownership,
            ssl: domain.status?.ssl,
            zoneId: domain.zoneId,
          });
        }
      } catch {
        // Domain permissions are optional; bucket browsing must still work.
      }
      const publicCustom = domains.some((domain) => domain.type === "custom" && domain.enabled);
      const publicManaged = domains.some((domain) => domain.type === "managed" && domain.enabled);
      return {
        name: bucket.name,
        creationDate: bucket.creation_date,
        jurisdiction: bucket.jurisdiction,
        location: bucket.location,
        access: publicCustom ? "public-custom" : publicManaged ? "public-managed" : "private",
        domains,
      };
    })
  );
};
