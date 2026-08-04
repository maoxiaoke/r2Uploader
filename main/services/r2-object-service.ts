import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type MetadataDirective,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  BucketItem,
  ObjectHead,
  ObjectItem,
  ObjectListPage,
  ShareLink,
} from "../../shared/contracts";
import { AppError } from "../core/app-error";
import { CloudflareClient, listBucketsWithDomains } from "./cloudflare-client";
import type { ProfileCredentials } from "./config-vault";

const REST_UPLOAD_LIMIT = 300 * 1024 * 1024;

interface RestObject {
  key?: string;
  size?: number | string;
  etag?: string;
  last_modified?: string;
  uploaded?: string;
  storage_class?: string;
  http_metadata?: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    contentLanguage?: string;
  };
  custom_metadata?: Record<string, string>;
}

const endpointFor = (profile: ProfileCredentials) => {
  if (profile.endpoint) return profile.endpoint.replace(/\/$/, "");
  const jurisdiction = profile.jurisdiction === "default" ? "" : `.${profile.jurisdiction}`;
  return `https://${profile.accountId}${jurisdiction}.r2.cloudflarestorage.com`;
};

const objectFromRest = (item: RestObject, access: ObjectItem["access"] = "private"): ObjectItem => ({
  key: item.key ?? "",
  displayName: (item.key ?? "").split("/").filter(Boolean).pop() ?? item.key ?? "",
  size: Number(item.size ?? 0),
  etag: item.etag?.replace(/^"|"$/g, ""),
  lastModified: item.last_modified ?? item.uploaded,
  contentType: item.http_metadata?.contentType,
  cacheControl: item.http_metadata?.cacheControl,
  storageClass: item.storage_class,
  access,
});

export class R2ObjectService {
  readonly cloudflare: CloudflareClient;
  readonly s3?: S3Client;

  constructor(readonly profile: ProfileCredentials) {
    this.cloudflare = new CloudflareClient(profile);
    if (profile.accessKeyId && profile.secretAccessKey) {
      this.s3 = new S3Client({
        region: profile.region || "auto",
        endpoint: endpointFor(profile),
        forcePathStyle: profile.forcePathStyle,
        credentials: {
          accessKeyId: profile.accessKeyId,
          secretAccessKey: profile.secretAccessKey,
        },
      });
    }
  }

  async listBuckets(): Promise<BucketItem[]> {
    if (this.profile.apiToken) return listBucketsWithDomains(this.profile);
    if (!this.s3) throw this.credentialsRequired();
    const result = await this.s3.send(new ListBucketsCommand({}));
    return (result.Buckets ?? []).map((bucket) => ({
      name: bucket.Name ?? "",
      creationDate: bucket.CreationDate?.toISOString(),
      access: "private",
      domains: [],
    }));
  }

  async createBucket(name: string) {
    if (!this.s3) throw this.credentialsRequired();
    await this.s3.send(new CreateBucketCommand({ Bucket: name }));
    return { name, access: "private" as const, domains: [] };
  }

  async deleteBucket(name: string) {
    if (!this.s3) throw this.credentialsRequired();
    await this.s3.send(new DeleteBucketCommand({ Bucket: name }));
    return true;
  }

  async listObjects(input: {
    bucket: string;
    prefix?: string;
    cursor?: string;
    delimiter?: string;
    limit?: number;
    includeInternal?: boolean;
  }): Promise<ObjectListPage> {
    const syncedAt = new Date().toISOString();
    if (this.profile.apiToken) {
      const response = await this.cloudflare.raw(
        this.cloudflare.objectPath(input.bucket),
        { method: "GET" },
        {
          prefix: input.prefix,
          cursor: input.cursor,
          delimiter: input.delimiter ?? "/",
          per_page: Math.min(input.limit ?? 1000, 1000),
        }
      );
      const body = (await response.json()) as {
        result?: RestObject[];
        result_info?: { cursor?: string; delimited?: string[] };
      };
      const cursor = body.result_info?.cursor;
      return {
        objects: (body.result ?? [])
          .map((item) => objectFromRest(item))
          .filter((item) => input.includeInternal || !item.key.endsWith("/.r2uploader-folder")),
        folders: (body.result_info?.delimited ?? []).filter(
          (folder) => input.prefix?.startsWith(".r2uploader-trash/") || !folder.startsWith(".r2uploader-trash/")
        ),
        cursor,
        hasMore: Boolean(cursor),
        syncedAt,
        source: "remote",
      };
    }
    if (!this.s3) throw this.credentialsRequired();
    const result = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.prefix,
        Delimiter: input.delimiter ?? "/",
        ContinuationToken: input.cursor,
        MaxKeys: Math.min(input.limit ?? 1000, 1000),
      })
    );
    return {
      objects: (result.Contents ?? []).map((item) => ({
        key: item.Key ?? "",
        displayName: (item.Key ?? "").split("/").filter(Boolean).pop() ?? item.Key ?? "",
        size: Number(item.Size ?? 0),
        etag: item.ETag?.replace(/^"|"$/g, ""),
        lastModified: item.LastModified?.toISOString(),
        storageClass: item.StorageClass,
        access: "private" as const,
      })).filter((item) => input.includeInternal || !item.key.endsWith("/.r2uploader-folder")),
      folders: (result.CommonPrefixes ?? [])
        .flatMap((item) => (item.Prefix ? [item.Prefix] : []))
        .filter((folder) => input.prefix?.startsWith(".r2uploader-trash/") || !folder.startsWith(".r2uploader-trash/")),
      cursor: result.NextContinuationToken,
      hasMore: Boolean(result.IsTruncated),
      syncedAt,
      source: "remote",
    };
  }

  async headObject(bucket: string, key: string): Promise<ObjectHead> {
    if (this.s3) {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        key,
        displayName: key.split("/").filter(Boolean).pop() ?? key,
        size: Number(head.ContentLength ?? 0),
        etag: head.ETag?.replace(/^"|"$/g, ""),
        lastModified: head.LastModified?.toISOString(),
        contentType: head.ContentType,
        cacheControl: head.CacheControl,
        contentDisposition: head.ContentDisposition,
        contentEncoding: head.ContentEncoding,
        contentLanguage: head.ContentLanguage,
        customMetadata: head.Metadata,
        storageClass: head.StorageClass,
        access: "private",
      };
    }
    const response = await this.cloudflare.raw(this.cloudflare.objectPath(bucket, key), {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    response.body?.destroy();
    const totalFromRange = response.headers.get("content-range")?.split("/").pop();
    return {
      key,
      displayName: key.split("/").filter(Boolean).pop() ?? key,
      size: Number(totalFromRange ?? response.headers.get("content-length") ?? 0),
      etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
      cacheControl: response.headers.get("cache-control") ?? undefined,
      contentDisposition: response.headers.get("content-disposition") ?? undefined,
      contentEncoding: response.headers.get("content-encoding") ?? undefined,
      contentLanguage: response.headers.get("content-language") ?? undefined,
      access: "private",
    };
  }

  async getObject(bucket: string, key: string, range?: string) {
    if (this.s3) {
      const result = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
      return {
        body: result.Body as Readable,
        contentType: result.ContentType ?? "application/octet-stream",
        contentLength: Number(result.ContentLength ?? 0),
        etag: result.ETag?.replace(/^"|"$/g, ""),
      };
    }
    const response = await this.cloudflare.raw(this.cloudflare.objectPath(bucket, key), {
      method: "GET",
      headers: range ? { Range: range } : undefined,
    });
    return {
      body: response.body as Readable,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      contentLength: Number(response.headers.get("content-length") ?? 0),
      etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? undefined,
    };
  }

  async putObject(input: {
    bucket: string;
    key: string;
    filePath: string;
    contentType?: string;
    onProgress?: (transferred: number, total: number) => void;
    signal?: AbortSignal;
  }) {
    const stat = fs.statSync(input.filePath);
    if (stat.size > REST_UPLOAD_LIMIT && !this.s3) {
      throw new AppError({
        kind: "VALIDATION",
        code: "S3_CREDENTIALS_REQUIRED_FOR_LARGE_UPLOAD",
        message: "Files larger than 300 MB require an R2 S3 Access Key ID and Secret Access Key.",
        action: "Edit this connection and add S3 credentials, then retry the transfer.",
        retryable: false,
      });
    }
    const stream = fs.createReadStream(input.filePath);
    let transferred = 0;
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        transferred += chunk.length;
        input.onProgress?.(transferred, stat.size);
        callback(null, chunk);
      },
    });
    const body = stream.pipe(progress);
    if (input.signal) {
      input.signal.addEventListener("abort", () => stream.destroy(new Error("Transfer cancelled")), {
        once: true,
      });
    }

    if (this.s3) {
      const upload = new Upload({
        client: this.s3,
        params: {
          Bucket: input.bucket,
          Key: input.key,
          Body: body,
          ContentLength: stat.size,
          ContentType: input.contentType,
        },
        queueSize: 3,
        partSize: Math.max(5 * 1024 * 1024, Math.ceil(stat.size / 9_500)),
        leavePartsOnError: false,
      });
      upload.on("httpUploadProgress", (event) => {
        input.onProgress?.(Number(event.loaded ?? transferred), Number(event.total ?? stat.size));
      });
      input.signal?.addEventListener("abort", () => void upload.abort(), { once: true });
      await upload.done();
    } else {
      await this.cloudflare.raw(this.cloudflare.objectPath(input.bucket, input.key), {
        method: "PUT",
        body: body as never,
        headers: {
          "Content-Type": input.contentType ?? "application/octet-stream",
          "Content-Length": String(stat.size),
        },
        signal: input.signal as never,
      });
    }
    const remote = await this.headObject(input.bucket, input.key);
    if (remote.size !== stat.size) {
      throw new AppError({
        kind: "PARTIAL_SUCCESS",
        code: "UPLOAD_VERIFICATION_FAILED",
        message: "The upload returned successfully, but the remote size did not match the local file.",
        action: "Keep the local file and retry after inspecting the remote object.",
        retryable: true,
        details: { localSize: stat.size, remoteSize: remote.size },
      });
    }
    return remote;
  }

  async copyObject(input: { sourceBucket: string; sourceKey: string; bucket: string; key: string }) {
    if (this.s3) {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          CopySource: `${encodeURIComponent(input.sourceBucket)}/${input.sourceKey
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
        })
      );
    } else {
      const source = await this.getObject(input.sourceBucket, input.sourceKey);
      await this.cloudflare.raw(this.cloudflare.objectPath(input.bucket, input.key), {
        method: "PUT",
        body: source.body as never,
        headers: {
          "Content-Type": source.contentType,
          ...(source.contentLength ? { "Content-Length": String(source.contentLength) } : {}),
        },
      });
    }
    return this.headObject(input.bucket, input.key);
  }

  async updateMetadata(
    bucket: string,
    key: string,
    metadata: {
      contentType?: string;
      cacheControl?: string;
      contentDisposition?: string;
      contentEncoding?: string;
      contentLanguage?: string;
      customMetadata?: Record<string, string>;
    }
  ) {
    if (!this.s3) {
      throw new AppError({
        kind: "VALIDATION",
        code: "S3_CREDENTIALS_REQUIRED_FOR_METADATA",
        message: "Editing object metadata requires R2 S3 credentials.",
        action: "Add an R2 Access Key ID and Secret Access Key to this connection, then retry.",
        retryable: false,
      });
    }
    await this.s3.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`,
      MetadataDirective: "REPLACE" as MetadataDirective,
      ContentType: metadata.contentType || undefined,
      CacheControl: metadata.cacheControl || undefined,
      ContentDisposition: metadata.contentDisposition || undefined,
      ContentEncoding: metadata.contentEncoding || undefined,
      ContentLanguage: metadata.contentLanguage || undefined,
      Metadata: metadata.customMetadata,
    }));
    return this.headObject(bucket, key);
  }

  async deleteObject(bucket: string, key: string) {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } else {
      await this.cloudflare.raw(this.cloudflare.objectPath(bucket, key), { method: "DELETE" });
    }
    try {
      await this.headObject(bucket, key);
    } catch (error) {
      const candidate = error as { data?: { kind?: string } };
      if (candidate?.data?.kind === "NOT_FOUND") return true;
      throw error;
    }
    throw new AppError({
      kind: "PARTIAL_SUCCESS",
      code: "DELETE_VERIFICATION_FAILED",
      message: "Cloudflare accepted the delete request, but the object is still visible.",
      action: "Refresh and retry permanent deletion.",
      retryable: true,
    });
  }

  async temporaryShare(bucket: string, key: string, expiresInSeconds: number): Promise<ShareLink> {
    if (!this.s3) {
      throw new AppError({
        kind: "VALIDATION",
        code: "S3_CREDENTIALS_REQUIRED_FOR_SHARE",
        message: "Temporary links require an R2 S3 Access Key ID and Secret Access Key.",
        action: "Add S3 credentials to this connection profile.",
        retryable: false,
      });
    }
    const safeExpiry = Math.max(1, Math.min(expiresInSeconds, 7 * 24 * 60 * 60));
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: safeExpiry,
    });
    return {
      url,
      kind: "temporary",
      expiresAt: new Date(Date.now() + safeExpiry * 1000).toISOString(),
    };
  }

  private credentialsRequired() {
    return new AppError({
      kind: "AUTHENTICATION",
      code: "R2_CREDENTIALS_REQUIRED",
      message: "This connection does not contain usable R2 credentials.",
      action: "Add a Cloudflare API token or R2 S3 credentials.",
      retryable: false,
    });
  }
}
