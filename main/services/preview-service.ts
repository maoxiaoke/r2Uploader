import { protocol } from "electron";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { getBootstrapState, getProfile } from "./config-vault";
import { cachedObject, storeCachedObject } from "./object-cache";
import { R2ObjectService } from "./r2-object-service";

interface PreviewGrant {
  profileId: string;
  bucket: string;
  key: string;
  expiresAt: number;
}

const grants = new Map<string, PreviewGrant>();

export const createPreviewGrant = (profileId: string, bucket: string, key: string) => {
  const token = randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  grants.set(token, { profileId, bucket, key, expiresAt });
  return {
    url: `r2preview://object/${token}`,
    kind: "local-preview" as const,
    expiresAt: new Date(expiresAt).toISOString(),
  };
};

export const registerPreviewProtocol = () => {
  protocol.handle("r2preview", async (request) => {
    const url = new URL(request.url);
    const token = url.pathname.replace(/^\//, "");
    const grant = grants.get(token);
    if (!grant || grant.expiresAt <= Date.now()) {
      grants.delete(token);
      return new Response("Preview link expired", { status: 401 });
    }
    try {
      const range = request.headers.get("range") ?? undefined;
      const service = new R2ObjectService(getProfile(grant.profileId));
      let head;
      try {
        head = await service.headObject(grant.bucket, grant.key);
      } catch {
        const stale = cachedObject(grant.profileId, grant.bucket, grant.key);
        if (stale) {
          return new Response(Readable.toWeb(fs.createReadStream(stale.filePath)) as BodyInit, {
            status: 200,
            headers: {
              "Content-Type": stale.entry.contentType,
              "Content-Length": String(stale.entry.size),
              "Cache-Control": "private, max-age=60",
              "X-R2Uploader-Cache": "stale-offline",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        throw new Error("Remote object and offline cache are unavailable");
      }
      const cached = !range ? cachedObject(grant.profileId, grant.bucket, grant.key, head.etag) : null;
      if (cached) {
        return new Response(Readable.toWeb(fs.createReadStream(cached.filePath)) as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": cached.entry.contentType,
            "Content-Length": String(cached.entry.size),
            "Cache-Control": "private, max-age=60",
            "ETag": cached.entry.etag ?? "",
            "X-R2Uploader-Cache": "hit",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const object = await service.getObject(grant.bucket, grant.key, range);
      if (!range && head.size <= 10 * 1024 * 1024 && getBootstrapState().preferences.cacheMaxBytes > 0) {
        const chunks: Buffer[] = [];
        for await (const chunk of object.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const data = Buffer.concat(chunks);
        storeCachedObject({
          profileId: grant.profileId,
          bucket: grant.bucket,
          key: grant.key,
          etag: object.etag,
          contentType: object.contentType,
          data,
          maxBytes: getBootstrapState().preferences.cacheMaxBytes,
        });
        return new Response(data as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": object.contentType,
            "Content-Length": String(data.length),
            "Cache-Control": "private, max-age=60",
            "X-R2Uploader-Cache": "stored",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const headers = new Headers({
        "Content-Type": object.contentType,
        "Cache-Control": "private, max-age=60",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      if (object.contentLength) headers.set("Content-Length", String(object.contentLength));
      if (object.etag) headers.set("ETag", object.etag);
      return new Response(Readable.toWeb(object.body) as BodyInit, {
        status: range ? 206 : 200,
        headers,
      });
    } catch {
      return new Response("Preview unavailable", { status: 502 });
    }
  });
};

export const prunePreviewGrants = () => {
  const now = Date.now();
  for (const [token, grant] of grants) if (grant.expiresAt <= now) grants.delete(token);
};
