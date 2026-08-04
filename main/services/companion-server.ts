import crypto, { randomUUID } from "node:crypto";
import https from "node:https";
import os from "node:os";
import { generate } from "selfsigned";
import type { CompanionSession } from "../../shared/contracts";
import { AppError } from "../core/app-error";
import { getBootstrapState, getProfile } from "./config-vault";
import { R2ObjectService } from "./r2-object-service";

interface RuntimeSession extends CompanionSession { token: string; server: https.Server; requests: Map<string, { minute: number; count: number }>; }
let active: RuntimeSession | null = null;

const lanAddress = () => {
  for (const entries of Object.values(os.networkInterfaces())) for (const address of entries ?? []) if (address.family === "IPv4" && !address.internal) return address.address;
  return "127.0.0.1";
};
const sendJson = (response: import("node:http").ServerResponse, status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(JSON.stringify(value)); };
const companionError = (zh: boolean, english: string, chinese: string) => ({ error: zh ? chinese : english });
const companionCopy = (zh: boolean) => zh ? { readOnly: "只读私有会话", refresh: "刷新", loading: "正在加载…", expires: "到期时间", folder: "文件夹", open: "打开", copyLink: "复制 15 分钟链接", copied: "已复制", empty: "此文件夹为空。" } : { readOnly: "Read-only private session", refresh: "Refresh", loading: "Loading…", expires: "expires", folder: "Folder", open: "Open", copyLink: "Copy 15m link", copied: "Copied", empty: "This folder is empty." };
const companionPage = (zh: boolean) => { const copy = companionCopy(zh); return `<!doctype html><html lang="${zh ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R2Uploader Companion</title><style>:root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f7f7f7}*{box-sizing:border-box}body{margin:0}main{max-width:880px;margin:auto;padding:28px 18px}header{display:flex;justify-content:space-between;gap:12px;align-items:center}h1{font-size:22px;margin:0}button,a{font:inherit}.muted{color:#737373;font-size:13px}.crumbs,.items{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.item{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;padding:12px;border:1px solid #ddd;border-radius:12px;background:white}.name{min-width:0;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;gap:6px}.btn{border:1px solid #ccc;border-radius:8px;background:white;color:#171717;padding:7px 10px;text-decoration:none}.primary{background:#171717;color:white;border-color:#171717}@media(prefers-color-scheme:dark){:root{color:#eee;background:#171717}.item,.btn{background:#242424;color:#eee;border-color:#444}.primary{background:#eee;color:#171717}}</style></head><body><main><header><div><h1>R2Uploader Companion</h1><p class="muted" id="scope">${copy.readOnly}</p></div><button class="btn" id="refresh">${copy.refresh}</button></header><div class="crumbs" id="crumbs"></div><div class="items" id="items"><p class="muted">${copy.loading}</p></div></main><script src="/app.js"></script></body></html>`; };
const companionScript = (zh: boolean) => `const text=${JSON.stringify(companionCopy(zh))};let prefix="";const items=document.querySelector("#items"),crumbs=document.querySelector("#crumbs"),scope=document.querySelector("#scope");const fmt=n=>new Intl.NumberFormat(undefined,{style:"unit",unit:n>1e9?"gigabyte":n>1e6?"megabyte":"kilobyte",maximumFractionDigits:1}).format(n/(n>1e9?1e9:n>1e6?1e6:1e3));async function load(next=prefix){items.textContent=text.loading;const r=await fetch("/api/list?prefix="+encodeURIComponent(next));if(!r.ok){items.textContent=(await r.json()).error;return}const d=await r.json();prefix=d.prefix;scope.textContent=text.readOnly+" · "+d.bucket+"/"+prefix+" · "+text.expires+" "+new Date(d.expiresAt).toLocaleString();crumbs.textContent="";const root=document.createElement("button");root.className="btn";root.textContent=d.bucket;root.onclick=()=>load(d.rootPrefix);crumbs.append(root);let acc=d.rootPrefix;for(const part of prefix.slice(d.rootPrefix.length).split("/").filter(Boolean)){acc+=part+"/";const b=document.createElement("button");b.className="btn";b.textContent=part;const p=acc;b.onclick=()=>load(p);crumbs.append(b)}items.textContent="";for(const folder of d.folders){const row=document.createElement("button");row.className="item";const name=document.createElement("span");name.className="name";name.append(document.createTextNode(text.folder+" · "+folder.slice(prefix.length)));const action=document.createElement("span");action.textContent=text.open+" →";row.append(name,action);row.onclick=()=>load(folder);items.append(row)}for(const object of d.objects){const row=document.createElement("div");row.className="item";const name=document.createElement("span");name.className="name";name.textContent=object.displayName+" · "+fmt(object.size);const actions=document.createElement("span");actions.className="actions";const open=document.createElement("a");open.className="btn";open.textContent=text.open;open.target="_blank";open.rel="noopener";open.href="/object?key="+encodeURIComponent(object.key);const share=document.createElement("button");share.className="btn primary";share.textContent=text.copyLink;share.onclick=async()=>{const q=await fetch("/api/share?key="+encodeURIComponent(object.key));const x=await q.json();if(q.ok){await navigator.clipboard.writeText(x.url);share.textContent=text.copied}else share.textContent=x.error};actions.append(open,share);row.append(name,actions);items.append(row)}if(!d.folders.length&&!d.objects.length)items.textContent=text.empty}document.querySelector("#refresh").onclick=()=>load();load();`;

const authorized = (request: import("node:http").IncomingMessage, session: RuntimeSession) => request.headers.cookie?.split(";").map((part) => part.trim()).includes(`r2c=${session.id}`);

export const startCompanion = async (input: { profileId: string; bucket: string; prefix: string; expiresInMinutes: number }): Promise<CompanionSession> => {
  await stopCompanion();
  const id = randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + Math.max(5, Math.min(input.expiresInMinutes, 120)) * 60_000).toISOString();
  const ip = lanAddress();
  const certificate = generate([{ name: "commonName", value: "R2Uploader Companion" }], { days: 1, keySize: 2048, algorithm: "sha256", extensions: [{ name: "basicConstraints", cA: false }, { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip }] }] });
  const service = new R2ObjectService(getProfile(input.profileId));
  const rootPrefix = input.prefix.replace(/^\/+/, "");
  const zh = getBootstrapState().preferences.locale === "zh-CN";
  const server = https.createServer({ key: certificate.private, cert: certificate.cert }, async (request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader("Referrer-Policy", "no-referrer");
    const client = request.socket.remoteAddress ?? "unknown";
    const minute = Math.floor(Date.now() / 60_000);
    const rate = active?.requests.get(client) ?? { minute, count: 0 };
    if (rate.minute !== minute) { rate.minute = minute; rate.count = 0; } rate.count += 1; active?.requests.set(client, rate);
    if (rate.count > 120) return sendJson(response, 429, companionError(zh, "Too many requests.", "请求过于频繁。"));
    if (!active || Date.now() >= Date.parse(active.expiresAt)) { void stopCompanion(); return sendJson(response, 410, companionError(zh, "This companion session expired.", "此伴侣会话已过期。")); }
    const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
    if (url.searchParams.get("token") === token) { response.writeHead(302, { Location: "/", "Set-Cookie": `r2c=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))}` }); return response.end(); }
    if (!authorized(request, active)) return sendJson(response, 401, companionError(zh, "Pairing token required or expired.", "配对令牌缺失或已过期。"));
    try {
      if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return response.end(companionPage(zh)); }
      if (url.pathname === "/app.js") { response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); return response.end(companionScript(zh)); }
      const requestedPrefix = url.searchParams.get("prefix") ?? rootPrefix;
      if (rootPrefix && !requestedPrefix.startsWith(rootPrefix)) return sendJson(response, 403, companionError(zh, "Path is outside the shared prefix.", "路径超出共享前缀范围。"));
      if (url.pathname === "/api/list") { const result = await service.listObjects({ bucket: input.bucket, prefix: requestedPrefix, delimiter: "/", limit: 1_000 }); return sendJson(response, 200, { ...result, bucket: input.bucket, prefix: requestedPrefix, rootPrefix, expiresAt }); }
      const key = url.searchParams.get("key") ?? "";
      if (!key || (rootPrefix && !key.startsWith(rootPrefix))) return sendJson(response, 403, companionError(zh, "Object is outside the shared prefix.", "对象超出共享前缀范围。"));
      if (url.pathname === "/api/share") return sendJson(response, 200, await service.temporaryShare(input.bucket, key, 900));
      if (url.pathname === "/object") { const object = await service.getObject(input.bucket, key, request.headers.range); response.writeHead(request.headers.range ? 206 : 200, { "Content-Type": object.contentType, "Content-Length": object.contentLength, "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", ...(object.etag ? { ETag: object.etag } : {}) }); object.body.pipe(response); return; }
      return sendJson(response, 404, companionError(zh, "Not found.", "未找到。"));
    } catch (error) { return sendJson(response, 500, { error: error instanceof Error ? error.message : (zh ? "请求失败。" : "Request failed.") }); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new AppError({ kind: "UNAVAILABLE", code: "COMPANION_PORT_UNAVAILABLE", message: "Could not open a local companion port.", retryable: true }); }
  active = { id, token, server, requests: new Map(), profileId: input.profileId, bucket: input.bucket, prefix: rootPrefix, url: `https://${ip}:${address.port}/?token=${encodeURIComponent(token)}`, expiresAt, certificateFingerprint: certificate.fingerprint, readOnly: true };
  setTimeout(() => { if (active?.id === id) void stopCompanion(); }, Date.parse(expiresAt) - Date.now()).unref();
  const { token: _token, server: _server, requests: _requests, ...summary } = active;
  return summary;
};

export const stopCompanion = async () => {
  const current = active;
  active = null;
  if (current) await new Promise<void>((resolve) => current.server.close(() => resolve()));
  return true;
};
export const companionStatus = (): CompanionSession | null => active ? (({ token: _token, server: _server, requests: _requests, ...summary }) => summary)(active) : null;
