import { ipcMain, clipboard } from "electron";
import fetch from "node-fetch";
import { getConfig } from "../helpers/get-config";
import { getBuckets } from "../helpers/buckets";
import { storeBuckets } from "../helpers/buckets";
import fs from "node:fs";
import { createDefaultFileStream } from "../helpers/create-default-file-stream";

const qsStringify = (params: Record<string, any>) => {
  return Object.entries(params)
    .filter(([_, value]) => !!value)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
};

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
  status: number;
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

  let newestBuckets = updatedBuckets;

  try {
    // get Managed Domain
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
              custom: bucket.domains?.custom,
            },
          };
        }

        return bucket;
      })
    );

    newestBuckets = storeBuckets(managedDomains, false);

    // get the custom Domain
    const needGetCustomDomainsBuckets = newestBuckets.filter(
      (bucket) => !bucket?.domains?.custom
    );

    const customDomainsUpdatedBuckets = await Promise.all(
      needGetCustomDomainsBuckets.map(async (bucket) => {
        const response = await _fetch(
          `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucket.name}/domains/custom`,
          {
            method: "GET",
          }
        );
        const data = await response.json();

        if (data?.success && data?.result) {
          return {
            ...bucket,
            domains: {
              managed: bucket.domains?.managed,
              custom: {
                domains: data.result?.domains ?? [],
              },
            },
          };
        }

        return bucket;
      })
    );

    newestBuckets = storeBuckets(customDomainsUpdatedBuckets, false);
  } catch (error) {
    // do nothing..., just log
  }

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
      prefix,
      per_page = 1000,
      delimiter = '/'
    }: {
      bucketName: string;
      cursor: string;
      prefix?: string;
      per_page?: number;
      delimiter?: string;
    }
  ) => {
    const qs = qsStringify({
      cursor,
      prefix,
      per_page,
      delimiter,
    });
    // console.log('qs', `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucketName}/objects${qs ? `?${qs}` : ""}`);
    const response = await _fetch(
      `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucketName}/objects${qs ? `?${qs}` : ""}`,
      {
        method: "GET",
      }
    );
    const data = await response.json();

    return data;
  }
);

/**
 * file exists
 */
ipcMain.handle("cf-check-file-exists", async (evt, { url }) => {
  try {
    const response = await _fetch(url, {
      method: "HEAD",
    });

    return response.status === 200;
  } catch (error) {
    return false;
  }
});

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
      fromPaste
    }: {
      bucketName: string;
      fileName: string;
      filePath: string;
      fileType: string;
      fromPaste: boolean;
    }
  ) => {
    let file;

    if (fromPaste) {
      const imageData = clipboard.readImage();
      // Convert NativeImage to Buffer instead of trying to use it as a file path
      const imageBuffer = imageData.toPNG();
      file = imageBuffer;
    } else {
      file = fs.createReadStream(filePath);
    }

    console.log('uploading file', filePath, fileName, file);

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

ipcMain.handle("cf-create-folder", async (event, { bucketName, fileName }) => {
  const defaultFileStream = await createDefaultFileStream();

  const response = await _fetch(
    `https://api.cloudflare.com/client/v4/accounts/*/r2/buckets/${bucketName}/objects/${fileName}`,
    {
      method: "PUT",
      body: defaultFileStream,
      headers: {
        "Content-Type": "text/plain",
      },
    }
  );
  const data = await response.json();

  return data;
});
