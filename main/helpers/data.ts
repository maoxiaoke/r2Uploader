import path from "path";
import { ensureAppHome } from "./path";
import fs from "fs";
import { safeParse } from "./json";
import { ensurePathExists } from "./path";

import type { BucketObject, BucketDelimiter } from "../../shared/types";

export interface BucketData {
  objects: {
    [key: string]: BucketObject;
  }
  delimiters: {
    [key: string]: BucketDelimiter;
  };
}

export const getBucketDataPath = (bucketName: string) => {
  ensurePathExists(path.join(ensureAppHome(), 'data'));
  return path.join(ensureAppHome(), 'data', `${bucketName}.json`);
}

export const getBucketData = (bucketName: string): BucketData => {
  const objStorePath = getBucketDataPath(bucketName);
  return safeParse(objStorePath, {});
}

export const storeBucketData = (bucketName: string, data: BucketData) => {
  const objStorePath = getBucketDataPath(bucketName);
  fs.writeFileSync(objStorePath, JSON.stringify(data, null, 2));
}

export const appendBucketObjects = (bucketName: string, objects: BucketObject[]) => {
  const data = getBucketData(bucketName);

  const appendObject = (obj: BucketObject) => {

    if (!data?.objects) {
      data.objects = {};
    }

    if (data?.objects?.[obj.key]) {
      data.objects[obj.key] = {
        ...data.objects[obj.key],
        ...obj,
      }
    } else {
      data.objects[obj.key] = obj;
    }
  }

  objects.forEach(obj => appendObject(obj));
  storeBucketData(bucketName, data);
}

export const deleteBucketObject = (bucketName: string, key: string) => {
  const data = getBucketData(bucketName);
  delete data.objects[key];
  storeBucketData(bucketName, data);
}

export const appendBucketDelimiters = (bucketName: string, delimiters: BucketDelimiter[]) => {
  const data = getBucketData(bucketName);

  const appendDelimiter = (delimiter: BucketDelimiter) => {
    if (!data?.delimiters) {
      data.delimiters = {};
    }

    if (data?.delimiters?.[delimiter.key]) {
      data.delimiters[delimiter.key] = {
        ...data.delimiters[delimiter.key],
        ...delimiter,
      };
    } else {
      data.delimiters[delimiter.key] = delimiter;
    }
  }

  delimiters.forEach(delimiter => appendDelimiter(delimiter));

  storeBucketData(bucketName, data);
}

export const deleteBucketDelimiter = (bucketName: string, key: string) => {
  const data = getBucketData(bucketName);
  delete data.delimiters[key];
  storeBucketData(bucketName, data);
}
