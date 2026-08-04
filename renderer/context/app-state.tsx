import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AppErrorData, AppPreferences, BootstrapState, Locale, ProfileSummary } from "../../shared/contracts";
import { errorData, unwrap } from "../lib/ipc";
import { textTranslator, translator, type MessageKey } from "../lib/i18n";

interface AppStateValue {
  bootstrap: BootstrapState | null;
  activeProfile: ProfileSummary | null;
  loading: boolean;
  error: AppErrorData | null;
  refresh: () => Promise<void>;
  switchProfile: (profileId: string) => Promise<void>;
  updatePreferences: (input: Partial<AppPreferences>) => Promise<void>;
  t: (key: MessageKey) => string;
  tx: (english: string) => string;
}

const AppStateContext = createContext<AppStateValue | null>(null);

const applyTheme = (theme: BootstrapState["preferences"]["theme"]) => {
  const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = theme === "system" ? (preferredDark ? "dark" : "light") : theme;
};

const applyAccessibilityPreferences = (preferences: BootstrapState["preferences"]) => {
  document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
};

export const AppStateProvider = ({ children }: { children: React.ReactNode }) => {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppErrorData | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = unwrap<BootstrapState>(await window.r2.app.bootstrap());
      setBootstrap(next);
      applyTheme(next.preferences.theme);
      applyAccessibilityPreferences(next.preferences);
      document.documentElement.lang = next.preferences.locale;
      setError(null);
    } catch (problem) {
      setError(errorData(problem));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => bootstrap?.preferences.theme === "system" && applyTheme("system");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [bootstrap?.preferences.theme]);

  const switchProfile = useCallback(
    async (profileId: string) => {
      unwrap(await window.r2.profiles.switch(profileId));
      await refresh();
    },
    [refresh]
  );

  const updatePreferences = useCallback(async (input: Partial<AppPreferences>) => {
    const preferences = unwrap<AppPreferences>(await window.r2.app.updatePreferences(input));
    setBootstrap((current) => current ? { ...current, preferences } : current);
    applyTheme(preferences.theme);
    applyAccessibilityPreferences(preferences);
    document.documentElement.lang = preferences.locale;
  }, []);

  const activeProfile = useMemo(
    () => bootstrap?.profiles.find((profile) => profile.id === bootstrap.activeProfileId) ?? null,
    [bootstrap]
  );
  const locale: Locale = bootstrap?.preferences.locale ?? "zh-CN";
  const t = useMemo(() => translator(locale), [locale]);
  const tx = useMemo(() => textTranslator(locale), [locale]);

  return (
    <AppStateContext.Provider value={{ bootstrap, activeProfile, loading, error, refresh, switchProfile, updatePreferences, t, tx }}>
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = () => {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
};
