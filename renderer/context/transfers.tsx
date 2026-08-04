import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { TransferItem } from "../../shared/contracts";
import { unwrap } from "../lib/ipc";

interface TransferContextValue {
  items: TransferItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
  pause: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  openDownload: (id: string) => Promise<void>;
  revealDownload: (id: string) => Promise<void>;
  activeCount: number;
}

const TransferContext = createContext<TransferContextValue | null>(null);

export const TransferProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<TransferItem[]>([]);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(async () => setItems(unwrap<TransferItem[]>(await window.r2.transfers.list())), []);

  useEffect(() => {
    void refresh();
    return window.r2.transfers.onUpdated((next) => setItems(next as TransferItem[]));
  }, [refresh]);

  const perform = useCallback(async (action: Promise<unknown>) => {
    unwrap(action instanceof Promise ? await action : action);
    await refresh();
  }, [refresh]);

  const value = useMemo<TransferContextValue>(() => ({
    items,
    open,
    setOpen,
    refresh,
    cancel: (id) => perform(window.r2.transfers.cancel(id)),
    pause: (id) => perform(window.r2.transfers.pause(id)),
    retry: (id) => perform(window.r2.transfers.retry(id)),
    clear: () => perform(window.r2.transfers.clear()),
    openDownload: (id) => perform(window.r2.transfers.openDownload(id)),
    revealDownload: (id) => perform(window.r2.transfers.revealDownload(id)),
    activeCount: items.filter((item) => ["queued", "running", "paused"].includes(item.status)).length,
  }), [items, open, perform, refresh]);

  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
};

export const useTransfers = () => {
  const value = useContext(TransferContext);
  if (!value) throw new Error("useTransfers must be used inside TransferProvider");
  return value;
};
