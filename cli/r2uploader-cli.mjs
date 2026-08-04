#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const usage = () => {
  process.stdout.write("Usage: r2uploader upload <file...> [--profile <id>] [--bucket <name>] [--prefix <path>]\nThe desktop app always shows a confirmation before reading or uploading files.\n");
};
if (args[0] !== "upload") { usage(); process.exit(args.includes("--help") ? 0 : 1); }
const values = { files: [], profile: "", bucket: "", prefix: "" };
for (let index = 1; index < args.length; index += 1) {
  const value = args[index];
  if (["--profile", "--bucket", "--prefix"].includes(value)) { values[value.slice(2)] = args[++index] ?? ""; }
  else values.files.push(path.resolve(value));
}
if (!values.files.length || values.files.some((file) => !fs.existsSync(file) || !fs.statSync(file).isFile())) { process.stderr.write("Every upload source must be an existing file.\n"); process.exit(2); }
const url = new URL("r2uploader://upload");
url.searchParams.set("v", "1");
url.searchParams.set("client", "r2uploader-cli");
values.files.forEach((file) => url.searchParams.append("path", file));
if (values.profile) url.searchParams.set("profile", values.profile);
if (values.bucket) url.searchParams.set("bucket", values.bucket);
if (values.prefix) url.searchParams.set("prefix", values.prefix);
const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
const commandArgs = process.platform === "win32" ? ["/c", "start", "", url.toString()] : [url.toString()];
const child = spawn(command, commandArgs, { detached: true, stdio: "ignore", windowsHide: true });
child.unref();
process.stdout.write(`Sent ${values.files.length} file(s) to R2Uploader for confirmation.\n`);
