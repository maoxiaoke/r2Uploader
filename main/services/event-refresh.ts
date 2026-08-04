import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { EventRefreshSubscription } from "../../shared/contracts";
import { IPC_CHANNELS } from "../../shared/contracts";
import { toAppError } from "../core/app-error";
import { CloudflareClient, encodePathSegment } from "./cloudflare-client";
import { getProfile } from "./config-vault";
import { readJson, writeJson } from "./json-store";

const FILE = "event-refresh.json";
interface QueueMessage { body?: string | Record<string, unknown>; lease_id?: string; }

class EventRefreshManager {
  private timer?: NodeJS.Timeout;
  private polling = new Set<string>();
  initialize() {
    this.timer = setInterval(() => { for (const subscription of this.list().filter((item) => item.enabled)) void this.poll(subscription.id); }, 15_000);
    this.timer.unref();
  }
  list(profileId?: string, bucket?: string) { return readJson<EventRefreshSubscription[]>(FILE, []).filter((item) => (!profileId || item.profileId === profileId) && (!bucket || item.bucket === bucket)); }
  async subscribe(input: { profileId: string; bucket: string; queueId: string }) {
    const client = new CloudflareClient(getProfile(input.profileId));
    const path = client.accountApiPath(`/event_notifications/r2/${encodePathSegment(input.bucket)}/configuration/queues/${encodePathSegment(input.queueId)}`);
    await client.json(path, { method: "PUT", body: JSON.stringify({ rules: [{ actions: ["PutObject", "CopyObject", "CompleteMultipartUpload", "DeleteObject", "LifecycleDeletion"], description: "R2Uploader desktop refresh" }] }) });
    const remote = await client.json<{ queueId?: string; queueName?: string }>(path);
    const items = readJson<EventRefreshSubscription[]>(FILE, []);
    const existing = items.find((item) => item.profileId === input.profileId && item.bucket === input.bucket && item.queueId === input.queueId);
    const subscription: EventRefreshSubscription = { id: existing?.id ?? randomUUID(), profileId: input.profileId, bucket: input.bucket, queueId: input.queueId, queueName: remote.queueName, enabled: true, status: "active", lastCheckedAt: new Date().toISOString(), lastEventAt: existing?.lastEventAt };
    writeJson(FILE, [subscription, ...items.filter((item) => item.id !== subscription.id)]);
    void this.poll(subscription.id);
    return subscription;
  }
  pause(id: string, paused: boolean) {
    const items = readJson<EventRefreshSubscription[]>(FILE, []);
    const item = items.find((subscription) => subscription.id === id);
    if (!item) throw new Error("Event refresh subscription not found.");
    item.enabled = !paused; item.status = paused ? "paused" : "active"; item.lastError = undefined;
    writeJson(FILE, items);
    return item;
  }
  async poll(id: string) {
    if (this.polling.has(id)) return;
    const items = readJson<EventRefreshSubscription[]>(FILE, []);
    const item = items.find((subscription) => subscription.id === id);
    if (!item?.enabled) return;
    this.polling.add(id);
    try {
      const client = new CloudflareClient(getProfile(item.profileId));
      const base = client.accountApiPath(`/queues/${encodePathSegment(item.queueId)}/messages`);
      const pulled = await client.json<{ messages?: QueueMessage[]; message_backlog_count?: number }>(`${base}/pull`, { method: "POST", body: JSON.stringify({ batch_size: 100, visibility_timeout_ms: 30_000 }) });
      const messages = pulled.messages ?? [];
      const keys: string[] = [];
      for (const message of messages) {
        let body: Record<string, unknown> | undefined;
        try { body = typeof message.body === "string" ? JSON.parse(message.body) as Record<string, unknown> : message.body; } catch { body = undefined; }
        const object = body?.object as { key?: string } | undefined;
        if (body?.bucket === item.bucket && object?.key) keys.push(object.key);
      }
      const leases = messages.flatMap((message) => message.lease_id ? [{ lease_id: message.lease_id }] : []);
      if (leases.length) await client.json(`${base}/ack`, { method: "POST", body: JSON.stringify({ acks: leases, retries: [] }) });
      item.status = "active"; item.lastCheckedAt = new Date().toISOString(); item.lastError = undefined;
      if (keys.length) {
        item.lastEventAt = new Date().toISOString();
        for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.remoteObjectsChanged, { profileId: item.profileId, bucket: item.bucket, keys, receivedAt: item.lastEventAt });
      }
      writeJson(FILE, items);
    } catch (error) {
      item.status = "fallback-polling"; item.lastCheckedAt = new Date().toISOString(); item.lastError = toAppError(error);
      writeJson(FILE, items);
    } finally { this.polling.delete(id); }
  }
}

export const eventRefreshManager = new EventRefreshManager();
