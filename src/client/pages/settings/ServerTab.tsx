import { useState, useEffect } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import { SETTINGS_REGISTRY } from "@shared/settings-defaults";

function InfoTip({ settingKey }: { settingKey: string }) {
  const tip = SETTINGS_REGISTRY[settingKey]?.tooltip;
  if (!tip) return null;
  return <span className="text-muted cursor-help" title={tip}>&#9432;</span>;
}

const serverKeys = ["server.pollInterval", "server.stabilityThreshold", "server.writePollInterval"] as const;

export function ServerTab() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [local, setLocal] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const vals: Record<string, number> = {};
    for (const k of serverKeys) vals[k] = settings[k];
    setLocal(vals);
    setDirty(false);
  }, [settings]);

  const set = (key: string, value: number) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    await updateSettings(local);
    setDirty(false);
  };

  const reset = async () => {
    await resetSettings([...serverKeys]);
  };

  return (
    <div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 text-sm text-amber-800">
        ⚠️ Server settings require a restart to take effect.
      </div>

      <div>
        {serverKeys.map((key) => {
          const def = SETTINGS_REGISTRY[key];
          const label = key.split(".").pop()!;
          return (
            <div key={key} className="flex justify-between items-center py-3 border-b border-border">
              <span className="font-bold text-primary-dark flex items-center gap-1">
                {label} <InfoTip settingKey={key} />
              </span>
              <input
                type="number"
                min={def?.min}
                max={def?.max}
                value={local[key] ?? ""}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n)) set(key, n);
                }}
                className="w-32 rounded border border-border px-2 py-1 text-sm text-right focus:border-primary focus:outline-none"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border">
        <span className="text-sm text-muted">Server settings apply after restart.</span>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="rounded border border-border px-4 py-1.5 text-sm text-muted hover:text-primary-dark hover:border-primary-dark"
          >
            Reset to Defaults
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className="rounded bg-primary px-4 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
