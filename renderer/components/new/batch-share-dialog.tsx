import { useEffect, useMemo, useState } from "react";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import type { AppErrorData, ObjectItem, ShareLink } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { errorData, unwrap } from "../../lib/ipc";
import { formatShare } from "../../lib/share";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

export const BatchShareDialog = ({ open, onClose, profileId, bucket, items }: { open: boolean; onClose: () => void; profileId: string; bucket: string; items: ObjectItem[] }) => {
  const { bootstrap, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [kind, setKind] = useState<"temporary" | "public">("temporary");
  const [expiry, setExpiry] = useState(3_600);
  const [template, setTemplate] = useState("url");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<AppErrorData | null>(null);
  const shareTemplates = useMemo(() => ({ ...(bootstrap?.preferences.customShareTemplates ?? {}), ...(bootstrap?.preferences.profileShareTemplates[profileId] ?? {}) }), [bootstrap?.preferences.customShareTemplates, bootstrap?.preferences.profileShareTemplates, profileId]);
  useEffect(() => { if (open) { setResult(""); setError(null); } }, [open, items]);
  const templates = useMemo(() => ["url", "markdown", "markdown-table", "html", "css", "json", "csv", ...Object.keys(shareTemplates)], [shareTemplates]);
  const generate = async () => {
    setBusy(true);
    setError(null);
    const generated: Array<{ item: ObjectItem; share: ShareLink }> = [];
    const failures: AppErrorData[] = [];
    for (const item of items) {
      try {
        const share = unwrap<ShareLink>(await window.r2.objects.share({ profileId, bucket, key: item.key, kind, expiresInSeconds: expiry }));
        generated.push({ item, share });
      } catch (problem) { failures.push(errorData(problem)); }
    }
    const csv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const output = template === "json"
      ? JSON.stringify(generated.map(({ item, share }) => ({ name: item.displayName, key: item.key, url: share.url, expiresAt: share.expiresAt ?? null })), null, 2)
      : template === "markdown-table"
        ? ["| Name | URL | Expires |", "| --- | --- | --- |", ...generated.map(({ item, share }) => `| ${item.displayName.replace(/\|/g, "\\|")} | ${share.url} | ${share.expiresAt ?? "never"} |`)].join("\n")
        : template === "csv"
          ? ["name,key,url,expiresAt", ...generated.map(({ item, share }) => [item.displayName, item.key, share.url, share.expiresAt ?? ""].map(csv).join(","))].join("\n")
          : generated.map(({ item, share }) => formatShare(item, share, template, shareTemplates)).join("\n");
    setResult(output);
    if (failures.length) setError({ kind: generated.length ? "PARTIAL_SUCCESS" : failures[0].kind, code: "BATCH_SHARE_PARTIAL", message: `${generated.length}/${items.length} links generated.`, action: failures.map((failure) => failure.message).join("; "), retryable: failures.some((failure) => failure.retryable) });
    setBusy(false);
  };
  return <Modal open={open} onClose={onClose} title={tx("Batch link manifest")} description={zh ? `已选择 ${items.length} 个对象；输出顺序与当前列表一致。` : `${items.length} selected objects. Output order matches the current list order.`}><div className="space-y-4">
    {error ? <ErrorPanel error={error} /> : null}
    <SegmentedControl value={kind} onChange={(value) => setKind(value as "temporary" | "public")} aria-label={tx("Link access")}><SegmentedControl.Option value="temporary">{tx("Temporary bearer links")}</SegmentedControl.Option><SegmentedControl.Option value="public">{tx("Permanent public URLs")}</SegmentedControl.Option></SegmentedControl>
    {kind === "temporary" ? <label className="block text-sm font-medium">{tx("Expiry")}<select className="mt-2 h-9 w-full rounded-lg border border-default bg-surface px-3" value={expiry} onChange={(event) => setExpiry(Number(event.target.value))}><option value={900}>{tx("15 minutes")}</option><option value={3600}>{tx("1 hour")}</option><option value={86400}>{tx("1 day")}</option><option value={604800}>{tx("7 days")}</option></select></label> : <Alert color="warning" title={tx("Public access")} description={tx("These URLs remain accessible while the bucket's public domain stays enabled.")} />}
    <label className="block text-sm font-medium">{tx("Format")}<select className="mt-2 h-9 w-full rounded-lg border border-default bg-surface px-3" value={template} onChange={(event) => setTemplate(event.target.value)}>{templates.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
    {result ? <textarea aria-label={tx("Generated link manifest")} readOnly className="min-h-52 w-full rounded-xl border border-default bg-surface-secondary p-3 font-mono text-xs" value={result} /> : null}
    <div className="flex flex-wrap justify-end gap-2"><Button color="secondary" variant="outline" onClick={onClose}>{tx("Close")}</Button>{result ? <><Button color="secondary" variant="ghost" onClick={() => void window.r2.system.exportText({ defaultName: `${bucket}-links.${template === "json" ? "json" : template === "csv" ? "csv" : template === "html" ? "html" : "txt"}`, extension: template === "json" ? "json" : template === "csv" ? "csv" : template === "html" ? "html" : "txt", text: result })}>{tx("Export file")}</Button><Button color="success" variant="outline" onClick={() => void window.r2.system.copyText(result)}>{tx("Copy all")}</Button></> : null}<Button color="primary" loading={busy} disabled={!items.length} onClick={() => void generate()}>{tx("Generate")}</Button></div>
  </div></Modal>;
};
