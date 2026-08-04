import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Archive, Bug, Edit, Globe, History, Home, Loop, Plus, Settings, Storage, UploadDocuments } from "@openai/apps-sdk-ui/components/Icon";
import type { ProfileSummary } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { useTransfers } from "../../context/transfers";
import { ConnectionEditor } from "./connection-editor";
import { DiagnosticsDialog } from "./diagnostics-dialog";
import { ErrorPanel } from "./error-panel";
import { HistoryDialog } from "./history-dialog";
import { SettingsDialog } from "./settings-dialog";
import { TransferCenter } from "./transfer-center";
import { SyncBackupDialog } from "./sync-backup-dialog";
import { AutomationDialog } from "./automation-dialog";
import { CompanionDialog } from "./companion-dialog";
import { Modal } from "./modal";

export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const { bootstrap, activeProfile, loading, error, refresh, switchProfile, t, tx } = useAppState();
  const { items: transfers, setOpen: setTransfersOpen, activeCount } = useTransfers();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProfileSummary | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [syncBackupOpen, setSyncBackupOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const editing = (event.target as HTMLElement | null)?.matches("input, textarea, select, [contenteditable=true]");
      if (!editing && event.key === "?") { event.preventDefault(); setShortcutsOpen(true); }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); setSettingsOpen(true); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); setTransfersOpen(true); }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "j") { event.preventDefault(); setTransfersOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTransfersOpen]);

  const openConnection = (profile?: ProfileSummary | null) => {
    setEditingProfile(profile ?? null);
    setConnectionOpen(true);
  };

  const chooseProfile = async (profile: ProfileSummary) => {
    if (profile.id === activeProfile?.id) return;
    const unfinished = transfers.filter((item) => item.profileId === activeProfile?.id && ["queued", "running", "paused"].includes(item.status)).length;
    if (unfinished && !window.confirm(bootstrap?.preferences.locale === "zh-CN"
      ? `当前连接还有 ${unfinished} 个未完成传输。切换连接不会停止它们，它们仍会在后台继续。确定切换到“${profile.name}”吗？`
      : `${unfinished} transfer(s) are unfinished for the current connection. Switching does not stop them; they continue in the background. Switch to “${profile.name}”?`)) return;
    await switchProfile(profile.id);
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-titlebar window-drag flex items-center gap-2 pl-14 md:pl-14">
          <div className="window-no-drag flex size-8 items-center justify-center rounded-xl bg-primary text-primary-solid"><Storage className="size-5" /></div>
          <span className="sidebar-label heading-xs truncate">{t("appName")}</span>
        </div>

        <div className="window-no-drag px-3">
          <button className="sidebar-nav-item" data-active={router.pathname === "/home"} onClick={() => void router.push("/home")}>
            <Home className="size-5 shrink-0" /><span className="sidebar-label flex-1 truncate text-sm">{t("home")}</span>
          </button>
          <button className="sidebar-nav-item" onClick={() => setTransfersOpen(true)}>
            <UploadDocuments className="size-5 shrink-0" /><span className="sidebar-label flex-1 truncate text-sm">{t("transfers")}</span>{activeCount ? <Badge color="info" size="sm" pill>{activeCount}</Badge> : null}
          </button>
          <button className="sidebar-nav-item" onClick={() => setHistoryOpen(true)}>
            <History className="size-5 shrink-0" /><span className="sidebar-label flex-1 truncate text-sm">{tx("Operation history")}</span>
          </button>
          <button className="sidebar-nav-item" onClick={() => setSyncBackupOpen(true)}>
            <Archive className="size-5 shrink-0" /><span className="sidebar-label flex-1 truncate text-sm">{tx("Sync & backups")}</span>
          </button>
          <button className="sidebar-nav-item" onClick={() => setAutomationOpen(true)}>
            <Loop className="size-5 shrink-0" /><span className="sidebar-label flex-1 truncate text-sm">{tx("Automation")}</span>
          </button>
          <button className="sidebar-nav-item" onClick={() => setCompanionOpen(true)}>
            <Globe className="size-5 shrink-0" /><span className="sidebar-label flex-1 truncate text-sm">{tx("Web companion")}</span>
          </button>
          <button className="sidebar-nav-item" onClick={() => setDiagnosticsOpen(true)}>
            <Bug className="size-5 shrink-0" /><span className="sidebar-label flex-1 truncate text-sm">{t("diagnostics")}</span>
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-auto px-3">
          <div className="sidebar-label mb-2 flex items-center justify-between px-2">
            <span className="text-xs font-medium uppercase tracking-wide text-tertiary">{t("connection")}</span>
            <Button color="secondary" variant="ghost" size="3xs" uniform aria-label={t("addConnection")} onClick={() => openConnection(null)}><Plus /></Button>
          </div>
          {bootstrap?.profiles.map((profile) => (
            <div key={profile.id} className="sidebar-nav-item" data-active={profile.id === activeProfile?.id}>
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void chooseProfile(profile)} aria-current={profile.id === activeProfile?.id ? "page" : undefined}>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-xs font-semibold">{profile.name.slice(0, 1).toUpperCase()}</span>
                <span className="sidebar-profile-copy min-w-0 flex-1"><span className="block truncate text-sm">{profile.name}</span><span className="block truncate text-xs text-tertiary">…{profile.accountId.slice(-6)}</span></span>
              </button>
              <button type="button" aria-label={`${t("editConnection")}: ${profile.name}`} className="sidebar-label rounded p-1 text-tertiary hover:text-primary" onClick={() => openConnection(profile)}><Edit className="size-4" /></button>
            </div>
          ))}
          {!bootstrap?.profiles.length && !loading ? (
            <button className="sidebar-nav-item border border-dashed border-default" onClick={() => openConnection(null)}><Plus className="size-5" /><span className="sidebar-label text-sm">{t("addConnection")}</span></button>
          ) : null}
        </div>

        <div className="window-no-drag border-t border-subtle p-3">
          <button className="sidebar-nav-item" onClick={() => setSettingsOpen(true)}><Settings className="size-5" /><span className="sidebar-label text-sm">{t("settings")}</span></button>
          <button className="sidebar-nav-item" onClick={() => setShortcutsOpen(true)}><span className="flex size-5 items-center justify-center font-semibold" aria-hidden="true">?</span><span className="sidebar-label text-sm">{tx("Keyboard shortcuts")}</span></button>
          <p className="sidebar-label mt-2 px-2 text-[11px] text-tertiary">v{bootstrap?.version ?? "—"} · {tx("Free core")}</p>
        </div>
      </aside>

      <main className="app-main">
        <div className="window-drag pointer-events-none absolute inset-x-0 top-0 z-30 h-12" />
        {loading && !bootstrap ? (
          <div className="grid h-full place-items-center"><p className="text-sm text-secondary">{t("loading")}</p></div>
        ) : error && !bootstrap ? (
          <div className="page-container"><ErrorPanel error={error} onRetry={() => void refresh()} /></div>
        ) : children}
      </main>

      <ConnectionEditor open={connectionOpen} profile={editingProfile} onClose={() => setConnectionOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DiagnosticsDialog open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
      <HistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <SyncBackupDialog open={syncBackupOpen} onClose={() => setSyncBackupOpen(false)} />
      <AutomationDialog open={automationOpen} onClose={() => setAutomationOpen(false)} />
      <CompanionDialog open={companionOpen} onClose={() => setCompanionOpen(false)} />
      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title={tx("Keyboard shortcuts")} description={tx("All primary object actions remain available through normal keyboard focus and Enter or Space.")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm"><Shortcut keys="?" action={tx("Open this shortcut reference")} /><Shortcut keys="⌘/Ctrl + ," action={tx("Open Settings")} /><Shortcut keys="⌘/Ctrl + J" action={tx("Open Transfer Center")} /><Shortcut keys="⌘/Ctrl + Shift + T" action={tx("Open Transfer Center")} /><Shortcut keys="⌘/Ctrl + Shift + U" action={tx("Quick Upload clipboard image")} /><Shortcut keys="⌘/Ctrl + R" action={tx("Refresh the current bucket")} /><Shortcut keys="⌘/Ctrl + A" action={tx("Select all visible objects")} /><Shortcut keys="Shift + click" action={tx("Select a range")} /><Shortcut keys="Drag empty space" action={tx("Box-select objects")} /><Shortcut keys="Enter" action={tx("Open the focused object")} /><Shortcut keys="Space" action={tx("Select the focused object")} /><Shortcut keys="Esc" action={tx("Close dialog or clear selection")} /></dl>
      </Modal>
      <TransferCenter />
    </div>
  );
};

const Shortcut = ({ keys, action }: { keys: string; action: string }) => <><dt><kbd className="rounded-md border border-default bg-surface-secondary px-2 py-1 font-mono text-xs">{keys}</kbd></dt><dd className="text-secondary">{action}</dd></>;
