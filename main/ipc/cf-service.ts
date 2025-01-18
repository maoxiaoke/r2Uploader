import { ipcMain } from "electron";
import fetch from "node-fetch";
import { getConfig } from "../helpers/get-config";
import { getBuckets } from "../helpers/buckets";
import { storeBuckets } from "../helpers/buckets";
import fs from "node:fs";

const _fetch = async <T = any>(
  url: string,
  params: any
): Promise<{
  json: () => Promise<{
    success: boolean;
    errors: Array<{
      code: number;
      message: string;
    }>;
    messages: string[];
    result: T;
  }>;
}> => {
  const config = getConfig();
  const accountId = config.accountId;
  const r2Token = config.r2Token;

  if (!accountId || !r2Token) {
    return {
      json: async () => ({
        success: false,
        errors: [],
        messages: [],
        result: {} as T,
      }),
    };
  }

  const _url = url.replace("*", accountId);

  return fetch(_url, {
    ...params,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${r2Token}`,
      ...(params?.headers ?? {}),
    },
  });
};

/**
 * Get the buckets
 */
ipcMain.handle("cf-get-buckets", async (evt, { cacheOnly = false }) => {
  //
  const config = await getConfig();
  const accountId = config.accountId;
  const r2Token = config.r2Token;

  if (!accountId || !r2Token) {
    return {
      success: false,
      errors: [],
      messages: [],
      result: [],
    };
  }

  const buckets = getBuckets();

  if (buckets?.length && cacheOnly) {
    return {
      success: true,
      errors: [],
      messages: [],
      result: {
        buckets,
      },
    };
  }

  const response = await _fetch(
    "https://api.cloudflare.com/client/v4/accounts/*/r2/buckets",
    {
      method: "GET",
    }
  );

  const data = await response.json();

  const rspBuckets = data?.result?.buckets ?? [];

  if (!rspBuckets.length) {
    return data;
  }

  const updatedBuckets =
    data?.success && data?.result?.buckets
      ? storeBuckets(data?.result?.buckets ?? [], true)
      : [];

  // Try to get Managed Domain
  // https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/managed/

  const needGetManagedDomainsBuckets = updatedBuckets.filter(
    (bucket) => !bucket?.domains?.managed
  );

  const managedDomains = await Promise.all(
    needGetManagedDomainsBuckets.map(async (bucket) => {
      const response = await _fetch(
        `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucket.name}/domains/managed`,
        {
          method: "GET",
        }
      );
      const data = await response.json();

      if (data?.success && data?.result) {
        return {
          ...bucket,
          domains: {
            managed: data.result,
          },
        };
      }

      return bucket;
    })
  );

  const newestBuckets = storeBuckets(managedDomains, false);

  return {
    ...data,
    result: {
      buckets: newestBuckets,
    },
  };
});

/**
 * Get the bucket objects
 */
ipcMain.handle(
  "cf-get-bucket-objects",
  async (
    event,
    {
      bucketName,
      cursor,
    }: {
      bucketName: string;
      cursor: string;
    }
  ) => {
    const response = await _fetch(
      `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucketName}/objects${
        cursor ? `?cursor=${cursor}` : ""
      }`,
      {
        method: "GET",
      }
    );
    const data = await response.json();

    return data;
  }
);

/**
 * Upload file to bucket
 */
ipcMain.handle(
  "cf-upload-file",
  async (
    event,
    {
      bucketName,
      fileName,
      filePath,
      fileType,
    }: {
      bucketName: string;
      fileName: string;
      filePath: string;
      fileType: string;
    }
  ) => {
    const file = fs.createReadStream(filePath);

    const response = await _fetch(
      `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucketName}/objects/${fileName}`,
      {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": fileType ?? "application/octet-stream",
        },
      }
    );
    const data = await response.json();

    return data;
  }
);

ipcMain.handle("cf-enable-managed-domain", async (event, { bucketName }) => {
  const response = await _fetch(
    `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucketName}/domains/managed`,
    {
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
      }),
    }
  );
  const data = await response.json();

  if (data.success) {
    //
    const buckets = getBuckets();

    const updatedBuckets = buckets.map((bucket) => {
      if (bucket.name === bucketName) {
        return {
          ...bucket,
          domains: {
            managed: data.result,
          },
        };
      }

      return bucket;
    });

    const newestBuckets = storeBuckets(updatedBuckets);

    event.sender.send("buckets-updated", newestBuckets);
  }

  return data;
});

ipcMain.handle("cf-create-bucket", async (event, { name, location }) => {
  const response = await _fetch(
    "https://api.cloudflare.com/client/v4/accounts/*/r2/buckets",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        locationHint: location,
        storageClass: "Standard",
        "cf-r2-jurisdiction": "default",
      }),
    }
  );

  const data = await response.json();

  if (data.success) {
    // set the bucket public access
    let managedDomainData = null;
    try {
      const managedDomainResp = await _fetch(
        `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${data.result?.name}/domains/managed`,
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: true,
          }),
        }
      );
      managedDomainData = await managedDomainResp.json();
    } catch (error) {
      // do nothing...
      // We will try to enable managed domain when open this bucket
    }

    const buckets = getBuckets();

    const newestBuckets = storeBuckets([
      ...buckets,
      {
        ...data.result,
        domains: {
          managed: managedDomainData?.result,
        },
      },
    ]);

    event.sender.send("buckets-updated", newestBuckets);
  }
});

ipcMain.handle("cf-delete-bucket", async (event, { name }) => {
  const response = await _fetch(
    `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${name}`,
    {
      method: "DELETE",
    }
  );

  const data = await response.json();

  if (data.success) {
    const buckets = getBuckets();

    const updatedBuckets = buckets.filter((bucket) => bucket.name !== name);

    const newestBuckets = storeBuckets(updatedBuckets);

    event.sender.send("buckets-updated", newestBuckets);
  }

  return data;
});

ipcMain.handle("cf-delete-object", async (evt, { bucket, object }) => {
  const response = await _fetch(
    `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucket}/objects`,
    {
      method: "DELETE",
      body: JSON.stringify([object]),
    }
  );

  const data = await response.json();

  return data;
});
