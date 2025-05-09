import { useEffect, useState   } from "react";
import type { BucketDelimiter } from "../../shared/types";

export const useDelimiters = (delimiter: string, bucketName: string) => {
  const [delimiters, setDelimiters] = useState<BucketDelimiter[]>([]);

  useEffect(() => {
    (async () => {
      const bucketData = await window.electron.ipc.invoke('get-bucket-data', { bucketName });
      setDelimiters(bucketData.delimiters ?? {});
    })();
  }, [delimiter, bucketName]);

  return delimiters;
}