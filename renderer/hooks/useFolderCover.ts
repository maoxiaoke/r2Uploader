import { useEffect, useState   } from "react";
import type { BucketDelimiter, BucketObject } from "../../shared/types";

export const useFolderCover = (delimiter: string, bucketName: string, files: BucketObject[], publicDomain: string) => {
  useEffect(() => {
    if (delimiter === '/') {
      return;
    }

    const findTheFirstImageOfThisFolder = files.find(object => object.http_metadata?.contentType?.startsWith('image/'));

    if (!findTheFirstImageOfThisFolder) {
      window.electron.ipc.invoke('append-bucket-delimiters', {
        bucketName,
        delimiters: [{
          key: delimiter,
          coverImage: undefined
        }]
      });

      return;
    }

    const cover = `${publicDomain}/${findTheFirstImageOfThisFolder.key}`;

    window.electron.ipc.invoke('append-bucket-delimiters', {
      bucketName,
      delimiters: [{
        key: delimiter,
        coverImage: cover
      }]
    });

  }, [delimiter, files, publicDomain, bucketName]);
}

export const useAllDelimiters = (delimiter: string, bucketName: string) => {
  const [delimiters, setDelimiters] = useState<BucketDelimiter[]>([]);

  useEffect(() => {
    (async () => {
      const bucketData = await window.electron.ipc.invoke('get-bucket-data', { bucketName });
      setDelimiters(bucketData.delimiters ?? {});
    })();
  }, [delimiter, bucketName]);

  return delimiters;
}