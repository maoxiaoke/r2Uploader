import { useEffect, useState } from "react";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { Eye, EyeOff, Key, Lock } from "@openai/apps-sdk-ui/components/Icon";
import type { AppErrorData, ConnectionDiagnostic, Jurisdiction, ProfileSummary } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { errorData, unwrap } from "../../lib/ipc";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

interface FormState {
  name: string;
  accountId: string;
  jurisdiction: Jurisdiction;
  endpoint: string;
  apiToken: string;
  accessKeyId: string;
  secretAccessKey: string;
  provider: "r2" | "s3";
  region: string;
  forcePathStyle: boolean;
}

const emptyForm: FormState = {
  name: "",
  accountId: "",
  jurisdiction: "default",
  endpoint: "",
  apiToken: "",
  accessKeyId: "",
  secretAccessKey: "",
  provider: "r2",
  region: "auto",
  forcePathStyle: false,
};

export const ConnectionEditor = ({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile?: ProfileSummary | null;
  onClose: () => void;
}) => {
  const { bootstrap, refresh, switchProfile, t, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [error, setError] = useState<AppErrorData | null>(null);
  const [testWrite, setTestWrite] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(profile ? {
      name: profile.name,
      accountId: profile.accountId,
      jurisdiction: profile.jurisdiction,
      endpoint: profile.endpoint ?? "",
      apiToken: "",
      accessKeyId: "",
      secretAccessKey: "",
      provider: profile.provider,
      region: profile.region,
      forcePathStyle: profile.forcePathStyle,
    } : emptyForm);
    setSavedId(profile?.id ?? null);
    setDiagnostic(null);
    setError(null);
  }, [open, profile]);

  const update = (key: keyof FormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.apiToken && !form.accessKeyId && !profile?.hasApiToken && !profile?.hasS3Credentials) {
      setError({ kind: "VALIDATION", code: "CREDENTIAL_REQUIRED", message: "Add a Cloudflare API token or a complete S3 credential pair.", retryable: false });
      return;
    }
    if ((form.accessKeyId && !form.secretAccessKey) || (!form.accessKeyId && form.secretAccessKey)) {
      setError({ kind: "VALIDATION", code: "S3_PAIR_REQUIRED", message: "S3 Access Key ID and Secret Access Key must be saved together.", retryable: false });
      return;
    }
    setSaving(true);
    try {
      const saved = unwrap<ProfileSummary>(await window.r2.profiles.save({ ...form, id: profile?.id }));
      setSavedId(saved.id);
      await switchProfile(saved.id);
      await refresh();
      setError(null);
    } catch (problem) {
      setError(errorData(problem));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!savedId) return;
    setSaving(true);
    try {
      setDiagnostic(unwrap<ConnectionDiagnostic>(await window.r2.profiles.test({ profileId: savedId, testWrite })));
      setError(null);
    } catch (problem) {
      setError(errorData(problem));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!profile || !window.confirm(zh ? `删除本地连接配置“${profile.name}”？远端存储资源不会发生变化。` : `Delete local profile “${profile.name}”? Remote storage resources will not be changed.`)) return;
    try {
      unwrap(await window.r2.profiles.delete(profile.id));
      await refresh();
      onClose();
    } catch (problem) {
      setError(errorData(problem));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={profile ? t("editConnection") : t("addConnection")} description={t("keepSecretHint")}>
      <div className="space-y-5">
        {error ? <ErrorPanel error={error} /> : null}
        <div><span className="text-sm font-medium">{tx("Provider")}</span><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className={`rounded-xl border p-3 text-left ${form.provider === "r2" ? "border-info bg-info-soft" : "border-default"}`} onClick={() => update("provider", "r2")}><span className="block text-sm font-medium">{tx("Cloudflare R2")}</span><span className="text-xs text-secondary">{tx("Full bucket, domain, analytics, policy and event APIs")}</span></button><button type="button" className={`rounded-xl border p-3 text-left ${form.provider === "s3" ? "border-info bg-info-soft" : "border-default"}`} onClick={() => update("provider", "s3")}><span className="block text-sm font-medium">{tx("S3-compatible")}</span><span className="text-xs text-secondary">{tx("Private object workflows through a custom endpoint")}</span></button></div></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 sm:col-span-2"><span className="text-sm font-medium">{t("profileName")}</span><Input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Personal R2" autoComplete="off" /></label>
          {form.provider === "r2" ? <label className="space-y-1.5 sm:col-span-2"><span className="text-sm font-medium">{t("accountId")}</span><Input value={form.accountId} onChange={(event) => update("accountId", event.target.value)} placeholder="32-character account ID" autoComplete="off" /></label> : null}
          {form.provider === "r2" ? <label className="space-y-1.5"><span className="text-sm font-medium">{t("jurisdiction")}</span><select className="h-9 w-full rounded-lg border border-default bg-surface px-3 text-sm" value={form.jurisdiction} onChange={(event) => update("jurisdiction", event.target.value)}><option value="default">{tx("Default")}</option><option value="eu">{tx("European Union")}</option><option value="fedramp">FedRAMP</option></select></label> : <label className="space-y-1.5"><span className="text-sm font-medium">{tx("S3 region")}</span><Input value={form.region} onChange={(event) => update("region", event.target.value)} placeholder="us-east-1" /></label>}
          <label className="space-y-1.5"><span className="text-sm font-medium">{t("endpoint")}</span><Input value={form.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://…" autoComplete="off" /></label>
          {form.provider === "s3" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.forcePathStyle} onChange={(event) => update("forcePathStyle", event.target.checked)} />{tx("Use path-style bucket URLs")}</label> : null}
        </div>

        {form.provider === "r2" ? <section className="rounded-2xl border border-subtle p-4">
          <div className="flex items-center gap-2"><Lock className="size-5" /><h3 className="heading-sm">Cloudflare REST</h3>{profile?.hasApiToken ? <Badge color="success">{tx("Configured")} ····{profile.apiTokenLastFour}</Badge> : null}</div>
          <p className="mt-1 text-xs text-secondary">{t("apiTokenHint")}</p>
          <Input className="mt-3" type={showSecrets ? "text" : "password"} value={form.apiToken} onChange={(event) => update("apiToken", event.target.value)} placeholder={profile?.hasApiToken ? tx("Leave blank to keep saved token") : "Cloudflare API token"} autoComplete="new-password" startAdornment={<Key className="size-4" />} endAdornment={<button type="button" aria-label={tx("Toggle secret visibility")} className="text-secondary" onClick={() => setShowSecrets((value) => !value)}>{showSecrets ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>} />
        </section> : null}

        <section className="rounded-2xl border border-subtle p-4">
          <div className="flex items-center gap-2"><Key className="size-5" /><h3 className="heading-sm">{form.provider === "r2" ? "R2 S3" : tx("S3 credentials")}</h3>{profile?.hasS3Credentials ? <Badge color="success">{tx("Configured")} ····{profile.accessKeyLastFour}</Badge> : <Badge color="warning">{tx("Required")}</Badge>}</div>
          <p className="mt-1 text-xs text-secondary">{t("s3Hint")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input value={form.accessKeyId} onChange={(event) => update("accessKeyId", event.target.value)} placeholder={profile?.hasS3Credentials ? tx("Keep saved Access Key ID") : t("accessKeyId")} autoComplete="new-password" />
            <Input type={showSecrets ? "text" : "password"} value={form.secretAccessKey} onChange={(event) => update("secretAccessKey", event.target.value)} placeholder={profile?.hasS3Credentials ? tx("Keep saved Secret Access Key") : t("secretAccessKey")} autoComplete="new-password" />
          </div>
        </section>

        {diagnostic ? (
          <section className="space-y-2">
            {diagnostic.checks.map((check) => (
              <div key={check.id} className="flex items-start justify-between gap-3 rounded-xl bg-surface-secondary p-3">
                <div><p className="text-sm font-medium">{tx(check.label)}</p><p className="text-xs text-secondary">{tx(check.detail)}</p>{check.action ? <p className="mt-1 text-xs text-warning">{tx(check.action)}</p> : null}</div>
                <Badge color={check.status === "passed" ? "success" : check.status === "failed" ? "danger" : "secondary"}>{tx(check.status)}</Badge>
              </div>
            ))}
          </section>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-secondary"><input type="checkbox" checked={testWrite} onChange={(event) => setTestWrite(event.target.checked)} />{tx("Run a reversible write + cleanup test")}</label>
        <div className="flex flex-wrap justify-between gap-3">
          <div>{profile ? <Button color="danger" variant="ghost" onClick={() => void remove()}>{t("delete")}</Button> : null}</div>
          <div className="flex gap-2">
            <Button color="secondary" variant="outline" disabled={!savedId || saving} onClick={() => void test()}>{t("testConnection")}</Button>
            <Button color="primary" loading={saving} disabled={!form.name || (form.provider === "r2" ? !form.accountId : !form.endpoint)} onClick={() => void save()}>{t("save")}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
