import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { CheckCircle, Error, History, X } from "@openai/apps-sdk-ui/components/Icon";
import { useAppState } from "../../context/app-state";
import { useTransfers } from "../../context/transfers";
import { formatBytes } from "../../lib/format";

const statusColor = (status: string) =>
  status === "completed" ? "success" : status === "failed" || status === "partial" ? "danger" : "info";

export const TransferCenter = () => {
  const { t, tx, bootstrap } = useAppState();
  const { items, open, setOpen, cancel, pause, retry, clear, openDownload, revealDownload } = useTransfers();
  if (!open) return null;
  const locale = bootstrap?.preferences.locale;
  const zh = locale === "zh-CN";
  const activeItems = items.filter((item) => ["queued", "running", "paused"].includes(item.status));
  const activeBytes = activeItems.reduce((sum, item) => sum + item.bytesTotal, 0);
  const activeTransferred = activeItems.reduce((sum, item) => sum + item.bytesTransferred, 0);
  const overallProgress = activeBytes ? Math.min(100, activeTransferred / activeBytes * 100) : 0;
  const eta = (seconds?: number) => seconds === undefined ? "" : seconds < 60 ? (zh ? `${seconds} 秒` : `${seconds}s`) : seconds < 3_600 ? (zh ? `${Math.ceil(seconds / 60)} 分钟` : `${Math.ceil(seconds / 60)}m`) : (zh ? `${Math.ceil(seconds / 3_600)} 小时` : `${Math.ceil(seconds / 3_600)}h`);
  return (
    <aside className="transfer-drawer window-no-drag" aria-label={t("transfers")}>
      <header className="flex items-center justify-between border-b border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="size-5" />
          <h2 className="heading-sm">{t("transfers")}</h2>
          {items.length ? <Badge size="sm" color="secondary">{items.length}</Badge> : null}
        </div>
        <Button color="secondary" variant="ghost" size="sm" uniform aria-label={t("close")} onClick={() => setOpen(false)}><X /></Button>
      </header>
      {activeItems.length ? <div className="border-b border-subtle px-4 py-2"><div className="flex justify-between text-xs text-secondary"><span>{zh ? `${activeItems.length} 个未完成任务` : `${activeItems.length} unfinished task${activeItems.length === 1 ? "" : "s"}`}</span><span>{activeBytes ? `${Math.round(overallProgress)}% · ${formatBytes(activeTransferred, locale)} / ${formatBytes(activeBytes, locale)}` : tx("Preparing remote operations…")}</span></div><div className="progress-track mt-2"><div className="progress-bar" style={{ width: `${overallProgress}%` }} /></div></div> : null}
      <div className="max-h-[440px] overflow-auto p-2">
        {items.length === 0 ? (
          <p className="p-8 text-center text-sm text-tertiary">{t("noTransfers")}</p>
        ) : items.map((item) => (
          <article key={item.id} className="rounded-xl p-3 hover:bg-surface-secondary">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-secondary">
                {item.status === "completed" ? <CheckCircle className="size-5" /> : ["failed", "partial"].includes(item.status) ? <Error className="size-5" /> : <History className="size-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{item.key}</p>
                  <span className="flex shrink-0 items-center gap-1"><Badge size="sm" color="secondary">{tx(item.kind)}</Badge><Badge size="sm" color={statusColor(item.status) as "success" | "danger" | "info"}>{tx(item.status)}</Badge></span>
                </div>
                <p className="mt-0.5 truncate text-xs text-tertiary">{item.source && item.destination ? `${item.source} → ${item.destination}` : `${item.bucket} · ${formatBytes(item.bytesTransferred, locale)} / ${formatBytes(item.bytesTotal, locale)}`}</p>
                {item.source && item.destination ? <p className="mt-0.5 text-xs text-tertiary">{formatBytes(item.bytesTransferred, locale)} / {formatBytes(item.bytesTotal, locale)}</p> : null}
                {item.status === "running" && item.speedBytesPerSecond > 0 ? <p className="mt-0.5 text-xs text-tertiary">{formatBytes(item.speedBytesPerSecond, locale)}/s{item.etaSeconds !== undefined ? ` · ${zh ? "剩余" : "remaining"} ${eta(item.etaSeconds)}` : ""}</p> : null}
                <div className="progress-track mt-2"><div className="progress-bar" style={{ width: `${item.progress}%` }} /></div>
                {item.error ? <p className="mt-2 text-xs text-danger">{item.error.message}</p> : null}
                <div className="mt-2 flex gap-2">
                  {(item.status === "queued" || (item.status === "running" && ["upload", "download"].includes(item.kind))) ? <Button color="secondary" variant="ghost" size="xs" onClick={() => void pause(item.id)}>{tx("Pause")}</Button> : null}
                  {(["queued", "paused"].includes(item.status) || (item.status === "running" && ["upload", "download"].includes(item.kind))) ? (
                    <Button color="secondary" variant="ghost" size="xs" onClick={() => void cancel(item.id)}>{t("cancel")}</Button>
                  ) : null}
                  {["failed", "partial", "cancelled", "paused"].includes(item.status) ? (
                    <Button color="secondary" variant="outline" size="xs" onClick={() => void retry(item.id)}>{t("retry")}</Button>
                  ) : null}
                  {item.kind === "download" && item.status === "completed" ? <><Button color="primary" variant="outline" size="xs" onClick={() => void openDownload(item.id)}>{tx("Open with system")}</Button><Button color="secondary" variant="ghost" size="xs" onClick={() => void revealDownload(item.id)}>{tx("Show in folder")}</Button></> : null}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      {items.some((item) => ["completed", "failed", "cancelled", "partial"].includes(item.status)) ? (
        <footer className="border-t border-subtle p-3 text-right">
          <Button color="secondary" variant="ghost" size="sm" onClick={() => void clear()}>{t("clearFinished")}</Button>
        </footer>
      ) : null}
    </aside>
  );
};
