import { ipcMain } from "electron";
import { appendBucketDelimiters, getBucketData } from "../helpers/data";

ipcMain.handle("append-bucket-delimiters", async (evt, { bucketName, delimiters }) => {
  return appendBucketDelimiters(bucketName, delimiters);
});

ipcMain.handle("get-bucket-data", async (evt, { bucketName }) => {
  return getBucketData(bucketName);
});
