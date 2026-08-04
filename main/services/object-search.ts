import type { ObjectListPage } from "../../shared/contracts";
import type { R2ObjectService } from "./r2-object-service";

const MAX_SCAN = 50_000;
const MAX_RESULTS = 1_000;

export const searchObjectKeys = async (service: R2ObjectService, bucket: string, query: string): Promise<ObjectListPage> => {
  const needle = query.trim().toLocaleLowerCase();
  const objects: ObjectListPage["objects"] = [];
  let cursor: string | undefined;
  let scannedObjects = 0;
  do {
    const page = await service.listObjects({ bucket, cursor, delimiter: "", limit: 1_000 });
    scannedObjects += page.objects.length;
    for (const object of page.objects) if (object.key.toLocaleLowerCase().includes(needle)) {
      objects.push(object);
      if (objects.length >= MAX_RESULTS) break;
    }
    cursor = page.cursor;
  } while (cursor && scannedObjects < MAX_SCAN && objects.length < MAX_RESULTS);
  return { objects, folders: [], hasMore: false, syncedAt: new Date().toISOString(), source: "remote", scannedObjects, searchTruncated: Boolean(cursor) };
};
