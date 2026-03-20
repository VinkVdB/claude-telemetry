import { useState, useEffect } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import { SETTINGS_REGISTRY } from "@shared/settings-defaults";

function InfoTip({ settingKey }: { settingKey: string }) {
  const tip = SETTINGS_REGISTRY[settingKey]?.tooltip;
  if (!tip) return null;
  return <span className="text-muted cursor-help" title={tip}>&#9432;</span>;
}

interface SectionConfig {
  title: string;
  subtitle?: string;
  keys: string[];
}

const sections: SectionConfig[] = [
  {
    title: "Event Loading",
    subtitle: "Controls how many events are held in memory and navigation step size",
    keys: ["display.maxLoadedEvents", "display.jumpStepSize"],
  },
  {
    title: "Number Formatting",
    subtitle: "Thresholds for formatting costs and token counts",
    keys: ["display.costPrecisionThreshold", "display.tokenKThreshold", "display.tokenMThreshold"],
  },
  {
    title: "Time Display",
    subtitle: "Thresholds for relative time labels",
    keys: ["display.timeAgoJustNow", "display.timeAgoMinutes", "display.timeAgoHours"],
  },
  {
    title: "Trace View Layout",
    subtitle: "Dimensions for the trace waterfall view",
    keys: ["display.traceRowHeight", "display.traceMinSpanWidth", "display.traceLabelWidth"],
  },
];

const allDisplayKeys = sections.flatMap((s) => s.keys);

export function DisplayTab() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [local, setLocal] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const vals: Record<string, number> = {};
    for (const k of allDisplayKeys) vals[k] = settings[k];
    setLocal(vals);
    setDirty(false);
  }, [settings]);

  const set = (key: string, value: number) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setError(null);
  };

  const save = async () => {
    try {
      await updateSettings(local);
      setDirty(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reset = async () => {
    await resetSettings(allDisplayKeys);
    setError(null);
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded border border-red-200">
          {error}
        </div>
      )}

      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-sm font-semibold text-primary-dark mb-1">{section.title}</h3>
          {section.subtitle && (
            <p className="text-xs text-muted mb-3">{section.subtitle}</p>
          )}
          <div className="border border-border rounded-xl divide-y divide-border">
            {section.keys.map((key) => {
              const def = SETTINGS_REGISTRY[key];
              const label = key.split(".").pop()!;
              return (
                <div key={key} className="flex justify-between items-center py-3 px-4">
                  <span className="text-sm text-primary-dark flex items-center gap-1">
                    {label} <InfoTip settingKey={key} />
                  </span>
                  <input
                    type="number"
                    min={def?.min}
                    max={def?.max}
                    step={def?.max != null && def.max <= 1 ? 0.001 : 1}
                    value={local[key] ?? ""}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!isNaN(n)) set(key, n);
                    }}
                    className="w-28 rounded border border-border px-2 py-1 text-sm text-right focus:border-primary focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
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
  );
}
