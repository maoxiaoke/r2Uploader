import { useEffect, useState } from "react";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { DiagnosticBundle } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { errorData, unwrap } from "../../lib/ipc";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

export const DiagnosticsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t, tx } = useAppState();
  const [bundle, setBundle] = useState<DiagnosticBundle | null>(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    window.r2.diagnostics.get().then((result) => setBundle(unwrap<DiagnosticBundle>(result))).catch((problem) => setError(errorData(problem)));
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={t("diagnostics")} description={tx("Preview the redacted support bundle before exporting it.")}>
      {error ? <ErrorPanel error={error} /> : bundle ? (
        <div className="space-y-4">
          <Alert color="success" variant="soft" title={tx("Secret-safe by default")} description={tx("Tokens, license keys, complete bucket names, object keys, and custom domains are excluded.")} />
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-secondary">{tx("Version")}</dt><dd>{bundle.appVersion}</dd>
            <dt className="text-secondary">{tx("Platform")}</dt><dd>{bundle.platform}</dd>
            <dt className="text-secondary">{tx("Generated")}</dt><dd>{bundle.generatedAt}</dd>
            <dt className="text-secondary">{tx("Recent errors")}</dt><dd><Badge color={bundle.recentErrors.length ? "warning" : "success"}>{bundle.recentErrors.length}</Badge></dd>
          </dl>
          <pre className="max-h-64 overflow-auto rounded-xl bg-surface-secondary p-3 text-xs">{JSON.stringify(bundle, null, 2)}</pre>
          <div className="flex justify-end gap-2">
            <Button color="secondary" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button color="primary" onClick={() => void window.r2.diagnostics.export()}>{t("exportDiagnostics")}</Button>
          </div>
        </div>
      ) : <p className="text-sm text-secondary">{t("loading")}</p>}
    </Modal>
  );
};
