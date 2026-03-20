import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";
import { getDefaults } from "@shared/settings-defaults";

interface SettingsContextValue {
  settings: Record<string, any>;
  updateSettings: (updates: Record<string, any>) => Promise<void>;
  resetSettings: (keys?: string[]) => Promise<void>;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, any>>(getDefaults());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.settings.get()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const updateSettings = useCallback(async (updates: Record<string, any>) => {
    const merged = await api.settings.update(updates);
    setSettings(merged);
  }, []);

  const resetSettings = useCallback(async (keys?: string[]) => {
    await api.settings.reset(keys);
    const fresh = await api.settings.get();
    setSettings(fresh);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
