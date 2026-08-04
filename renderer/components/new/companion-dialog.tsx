import { useEffect, useState } from "react";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import type { AppErrorData, BucketItem, CompanionSession } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { formatDate } from "../../lib/format";
import { errorData, unwrap } from "../../lib/ipc";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

export const CompanionDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { activeProfile, bootstrap, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [buckets, setBuckets] = useState<BucketItem[]>([]);
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [session, setSession] = useState<CompanionSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppErrorData | null>(null);
  useEffect(() => {
    if (!open || !activeProfile) return;
    Promise.all([window.r2.buckets.list(activeProfile.id), window.r2.companion.status()]).then(([bucketResult, sessionResult]) => { setBuckets(unwrap(bucketResult)); setSession(unwrap(sessionResult)); }).catch((problem) => setError(errorData(problem)));
  }, [open, activeProfile?.id]);
  if (!activeProfile) return null;
  const start = async () => {
    if (!window.confirm(tx("Start a temporary HTTPS server reachable from devices on this local network? It is read-only, token-protected, and stops at expiry or when you stop it."))) return;
    setBusy(true);
    try { setSession(unwrap(await window.r2.companion.start({ profileId: activeProfile.id, bucket, prefix, expiresInMinutes: minutes, localNetworkConfirmation: true }))); setError(null); }
    catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title={tx("Web / mobile companion")} description={tx("Temporarily browse one bucket prefix from another device while this desktop app stays open.")}><div className="space-y-5">
    {error ? <ErrorPanel error={error} /> : null}
    <Alert color="warning" title={tx("Local HTTPS with explicit pairing")} description={tx("The app uses an ephemeral self-signed certificate and a 256-bit one-time URL token. Your mobile browser will show a certificate warning; compare the fingerprint shown here. Use only on a trusted local network.")} />
    {session ? <div className="rounded-xl border border-success-outline bg-success-soft p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium">{tx("Read-only session active")}</p><Badge color="success">{zh ? "到期时间" : "Expires"} {formatDate(session.expiresAt, bootstrap?.preferences.locale)}</Badge></div><p className="mt-3 break-all font-mono text-xs">{session.url}</p><p className="mt-2 break-all text-xs text-secondary">{tx("Certificate fingerprint")}: {session.certificateFingerprint}</p><div className="mt-3 flex justify-end gap-2"><Button color="secondary" variant="outline" onClick={() => void window.r2.system.copyText(`${session.url}\nCertificate fingerprint: ${session.certificateFingerprint}`)}>{tx("Copy pairing details")}</Button><Button color="danger" variant="outline" onClick={async () => { unwrap(await window.r2.companion.stop()); setSession(null); }}>{tx("Stop now")}</Button></div></div> : <><div className="grid gap-2 sm:grid-cols-2"><select className="h-8 rounded-lg border border-default bg-surface px-2 text-sm" value={bucket} onChange={(event) => setBucket(event.target.value)}><option value="">{tx("Choose bucket")}</option>{buckets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><Input value={prefix} onChange={(event) => setPrefix(event.target.value.replace(/^\/+/, ""))} placeholder={tx("Shared prefix (empty = entire bucket)")} /><label className="text-xs font-medium">{tx("Session minutes")}<Input className="mt-1" type="number" min={5} max={120} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label></div><div className="text-right"><Button color="primary" loading={busy} disabled={!bucket} onClick={() => void start()}>{tx("Start read-only session")}</Button></div></>}
    <div className="flex justify-end"><Button color="secondary" variant="outline" onClick={onClose}>{tx("Close")}</Button></div>
  </div></Modal>;
};
