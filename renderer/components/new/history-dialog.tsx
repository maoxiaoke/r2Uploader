import { useEffect, useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { History } from "@openai/apps-sdk-ui/components/Icon";
import type { AppErrorData, OperationRecord } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { formatDate } from "../../lib/format";
import { errorData, unwrap } from "../../lib/ipc";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

export const HistoryDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { activeProfile, bootstrap, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [error, setError] = useState<AppErrorData | null>(null);
  const [query, setQuery] = useState("");
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    window.r2.history.list().then((result) => { setRecords(unwrap<OperationRecord[]>(result).filter((record) => record.profileId === activeProfile?.id)); setError(null); }).catch((problem) => setError(errorData(problem)));
  }, [activeProfile?.id, open]);
  const visible = records.filter((record) => [record.action, record.bucket, record.key, record.targetBucket, record.targetKey, record.status, record.errorCode].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())));
  return (
    <Modal open={open} onClose={onClose} title={tx("Operation history")} description={`${activeProfile?.name ?? "—"} · ${tx("Stored only on this device for up to 90 days or 2,000 records. Exports contain full bucket names and object keys.")}`}>
      <Input className="mb-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx("Search action, bucket, key, status, or error code")} />
      {error ? <ErrorPanel error={error} /> : visible.length ? (
        <div className="max-h-[520px] space-y-2 overflow-auto">
          {visible.map((record) => (
            <article key={record.id} className="flex items-start gap-3 rounded-xl border border-subtle p-3">
              <div className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-surface-secondary"><History className="size-4" /></div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-medium capitalize">{tx(record.action.replace("-", " "))}</p><Badge color={record.status === "success" ? "success" : record.status === "partial" ? "warning" : "danger"}>{tx(record.status)}</Badge>{record.reversible ? <Badge color="info">{tx("recoverable")}</Badge> : null}</div><p className="mt-1 truncate font-mono text-xs text-secondary">{record.bucket}{record.key ? `/${record.key}` : ""}</p>{record.targetKey ? <p className="truncate font-mono text-xs text-secondary">→ {record.targetBucket}/{record.targetKey}</p> : null}<p className="mt-1 text-xs text-tertiary">{formatDate(record.createdAt, bootstrap?.preferences.locale)}{record.errorCode ? ` · ${record.errorCode}` : ""}</p></div>
              {record.reversible && record.status !== "failed" ? <Button color="warning" variant="outline" size="xs" loading={recoveringId === record.id} onClick={async () => { if (!window.confirm(zh ? `对这条“${tx(record.action.replace("-", " "))}”记录执行安全恢复？目标冲突绝不会被覆盖。` : `Run the safe recovery action for this ${record.action}? Existing destination conflicts are never overwritten.`)) return; setRecoveringId(record.id); try { unwrap(await window.r2.history.recover(record.id)); setRecords(unwrap<OperationRecord[]>(await window.r2.history.list()).filter((item) => item.profileId === activeProfile?.id)); setError(null); } catch (problem) { setError(errorData(problem)); } finally { setRecoveringId(null); } }}>{tx("Restore")}</Button> : null}
            </article>
          ))}
        </div>
      ) : <div className="p-10 text-center"><History className="mx-auto size-8 text-tertiary" /><p className="mt-3 text-sm text-secondary">{tx(records.length ? "No history matches this search." : "No operations recorded yet.")}</p></div>}
      <div className="mt-4 flex flex-wrap justify-between gap-2"><div className="flex gap-2"><Button color="secondary" variant="ghost" disabled={!records.length} onClick={() => void window.r2.system.exportText({ defaultName: `r2uploader-history-${new Date().toISOString().slice(0, 10)}.json`, extension: "json", text: JSON.stringify(records, null, 2) })}>{tx("Export JSON")}</Button><Button color="danger" variant="ghost" disabled={!records.length} onClick={async () => { if (!window.confirm(tx("Clear all local operation history? This cannot be undone."))) return; setRecords(unwrap<OperationRecord[]>(await window.r2.history.clear())); }}>{tx("Clear history")}</Button></div><Button color="secondary" variant="outline" onClick={onClose}>{tx("Close")}</Button></div>
    </Modal>
  );
};
