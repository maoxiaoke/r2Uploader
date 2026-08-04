import { useEffect, useMemo, useState } from "react";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import type { AppErrorData, BucketItem, ConflictPolicy } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { useTransfers } from "../../context/transfers";
import { errorData, unwrap } from "../../lib/ipc";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

export interface OrganizeSource {
  kind: "object" | "folder";
  key: string;
}

export const OrganizeDialog = ({
  open,
  onClose,
  onComplete,
  profileId,
  sourceBucket,
  sources,
  buckets,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => Promise<void>;
  profileId: string;
  sourceBucket: string;
  sources: OrganizeSource[];
  buckets: BucketItem[];
}) => {
  const { bootstrap, tx } = useAppState();
  const { setOpen: setTransfersOpen } = useTransfers();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [mode, setMode] = useState<"copy" | "move">("move");
  const [targetBucket, setTargetBucket] = useState(sourceBucket);
  const [targetPrefix, setTargetPrefix] = useState("");
  const [targetName, setTargetName] = useState("");
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("ask");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<AppErrorData | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetBucket(sourceBucket);
    setTargetPrefix("");
    setTargetName(sources.length === 1 ? (sources[0].key.replace(/\/$/, "").split("/").pop() || sources[0].key) : "");
    setProgress({ completed: 0, total: sources.length });
    setError(null);
  }, [open, sourceBucket, sources.length]);

  const preview = useMemo(() => sources.slice(0, 4).map((source) => {
    const name = sources.length === 1 ? targetName : source.key.replace(/\/$/, "").split("/").pop() || source.key;
    return `r2://${targetBucket}/${[targetPrefix.replace(/^\/+|\/+$/g, ""), name].filter(Boolean).join("/")}${source.kind === "folder" ? "/" : ""}`;
  }), [sources, targetBucket, targetName, targetPrefix]);

  const execute = async () => {
    setBusy(true);
    setError(null);
    const failures: AppErrorData[] = [];
    let completed = 0;
    let queuedObjects = 0;
    setProgress({ completed, total: sources.length });
    for (const source of sources) {
      const name = sources.length === 1 ? targetName : source.key.replace(/\/$/, "").split("/").pop() || source.key;
      const target = [targetPrefix.replace(/^\/+|\/+$/g, ""), name].filter(Boolean).join("/");
      try {
        if (source.kind === "folder") {
          const result = unwrap<{ total: number; queued: number; transferIds: string[] }>(await window.r2.folders.operate({
            operation: mode,
            profileId,
            sourceBucket,
            sourcePrefix: source.key,
            targetBucket,
            targetPrefix: target,
            conflictPolicy,
          }));
          queuedObjects += result.queued;
        } else {
          const result = unwrap<{ queued: number }>(await window.r2.objects.copy({ profileId, bucket: sourceBucket, key: source.key, targetBucket, targetKey: target, move: mode === "move", conflictPolicy }));
          queuedObjects += result.queued;
        }
        completed += 1;
      } catch (problem) {
        failures.push(errorData(problem));
      }
      setProgress({ completed, total: sources.length });
    }
    if (queuedObjects) {
      await onComplete();
      setTransfersOpen(true);
    }
    setBusy(false);
    if (failures.length) {
      setError({
        kind: completed ? "PARTIAL_SUCCESS" : failures[0].kind,
        code: completed ? "ORGANIZE_PARTIAL" : failures[0].code,
        message: completed ? `${completed}/${sources.length} items were added to the queue.` : failures[0].message,
        action: failures.map((failure) => failure.message).join("; "),
        retryable: failures.some((failure) => failure.retryable),
      });
    } else {
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={tx("Move or copy")} description={zh ? `已选择 ${sources.length} 项。每个复制目标完成验证前，源对象都会保留。` : `${sources.length} selected item${sources.length === 1 ? "" : "s"}. Source objects are preserved until every copied object is verified.`}>
      <div className="space-y-4">
        {error ? <ErrorPanel error={error} /> : null}
        <SegmentedControl value={mode} onChange={(value) => setMode(value as "copy" | "move")} aria-label={tx("Operation")}>
          <SegmentedControl.Option value="move">{tx("Move")}</SegmentedControl.Option>
          <SegmentedControl.Option value="copy">{tx("Copy")}</SegmentedControl.Option>
        </SegmentedControl>
        <label className="block text-sm font-medium">{tx("Destination bucket")}
          <select className="mt-2 h-9 w-full rounded-lg border border-default bg-surface px-3 text-sm" value={targetBucket} onChange={(event) => setTargetBucket(event.target.value)} disabled={busy}>
            {buckets.map((bucket) => <option key={bucket.name} value={bucket.name}>{bucket.name} · {bucket.access}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">{tx("Destination folder")}
          <Input className="mt-2" value={targetPrefix} onChange={(event) => setTargetPrefix(event.target.value.replace(/^\/+/, ""))} placeholder={tx("assets/2026 (bucket root when empty)")} disabled={busy} />
        </label>
        {sources.length === 1 ? <label className="block text-sm font-medium">{tx("Destination name")}<Input className="mt-2" value={targetName} onChange={(event) => setTargetName(event.target.value.replace(/[\\/]/g, ""))} disabled={busy} /></label> : null}
        <label className="block text-sm font-medium">{tx("Destination conflicts")}
          <select className="mt-2 h-9 w-full rounded-lg border border-default bg-surface px-3 text-sm" value={conflictPolicy} onChange={(event) => setConflictPolicy(event.target.value as ConflictPolicy)} disabled={busy}>
            <option value="ask">{tx("Stop and ask")}</option>
            <option value="skip">{tx("Skip existing")}</option>
            <option value="rename">{tx("Auto rename")}</option>
            <option value="overwrite">{tx("Overwrite")}</option>
          </select>
          <span className="mt-1 block text-xs font-normal text-secondary">{tx("One policy applies to every expanded object. Copy and move run in Transfer Center; move deletes a source only after its destination is verified.")}</span>
        </label>
        <Alert color="info" title={tx("Destination preview")} description={`${preview.join("\n")}${sources.length > preview.length ? `\n${zh ? `……以及另外 ${sources.length - preview.length} 项` : `…and ${sources.length - preview.length} more`}` : ""}`} />
        {busy ? <p className="text-sm text-secondary">{zh ? `已展开并排队 ${progress.completed}/${progress.total} 个顶层项目…` : `Expanded and queued ${progress.completed} of ${progress.total} top-level items…`}</p> : null}
        <div className="flex justify-end gap-2"><Button color="secondary" variant="outline" disabled={busy} onClick={onClose}>{tx("Cancel")}</Button><Button color="primary" loading={busy} disabled={!sources.length || !targetBucket || (sources.length === 1 && !targetName.trim())} onClick={() => void execute()}>{tx(mode === "move" ? "Queue move" : "Queue copy")}</Button></div>
      </div>
    </Modal>
  );
};
