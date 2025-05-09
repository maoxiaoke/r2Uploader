import path from "path";
import fs from "fs";
import { ensureAppHome } from "./path";
import { safeParse } from "./json";

import type { Bucket } from "../../shared/types";

const Buckets = "_buckets.json";

export const getBucketsPath = () => {
  return path.join(ensureAppHome(), Buckets);
};

export const getBuckets = (): Bucket[] => {
  const bucketsPath = getBucketsPath();
  return safeParse(bucketsPath, []);
};

export const getBucket = (bucketName: string): Bucket | undefined => {
  const buckets = getBuckets();
  return buckets.find((bucket) => bucket.name === bucketName);
};

export const getBucketPublicDomain = (bucketName: string): string | undefined => {
  const bucket = getBucket(bucketName);

  const customDomain = (
    bucket?.domains?.custom?.domains ?? []
  ).filter((dom) => dom.enabled)[0];

  return `https://${customDomain ?? bucket?.domains?.managed?.domain}`;
};

export const storeBuckets = (buckets: Bucket[] | Bucket, clear = true) => {
  const _buckets = Array.isArray(buckets) ? buckets : [buckets];
  const storedBuckets = getBuckets();

  if (clear) {
    const updatedBuckets = _buckets.map((bucket) => {
      const index = storedBuckets.findIndex((b) => b.name === bucket.name);

      if (index === -1) {
        return bucket;
      }

      return {
        ...storedBuckets[index],
        ...bucket,
      };
    });

    fs.writeFileSync(getBucketsPath(), JSON.stringify(updatedBuckets, null, 2));
    return updatedBuckets;
  }

  for (let i = 0; i < _buckets.length; i++) {
    const bucket = _buckets[i];

    const index = storedBuckets.findIndex((b) => b.name === bucket.name);

    if (index === -1) {
      storedBuckets.push(bucket);
    } else {
      storedBuckets[index] = {
        ...storedBuckets[index],
        ...bucket,
      };
    }
  }

  fs.writeFileSync(getBucketsPath(), JSON.stringify(storedBuckets, null, 2));

  return storedBuckets;
};
