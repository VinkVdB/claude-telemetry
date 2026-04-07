import { useState, useEffect, useRef } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import { SETTINGS_REGISTRY } from "@shared/settings-defaults";
import { Tooltip } from "../../components/ui/Tooltip";
import { useToast } from "../../hooks/useToast";

function NumberField({
  settingKey,
  value,
  onChange,
}: {
  settingKey: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const def = SETTINGS_REGISTRY[settingKey];
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted flex items-center gap-1">
        {settingKey.split(".").pop()} <Tooltip text={SETTINGS_REGISTRY[settingKey]?.tooltip} />
      </span>
      <input
        type="number"
        min={def?.min}
        max={def?.max}
        step={def?.max != null && def.max <= 1 ? 0.01 : 1}
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
        className="w-24 rounded border border-border px-2 py-1 text-sm focus:border-primary focus:outline-none"
      />
    </div>
  );
}

function ColorSwatch({
  color,
  onChange,
}: {
  color: string;
  onChange: (hex: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className="relative w-6 h-6 rounded cursor-pointer border border-border overflow-hidden"
      style={{ backgroundColor: color }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
      />
    </div>
  );
}

export function GraphTab() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [local, setLocal] = useState<Record<string, any>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast, ToastNode } = useToast();

  const graphKeys = Object.keys(SETTINGS_REGISTRY).filter((k) => k.startsWith("graph."));

  useEffect(() => {
    const vals: Record<string, any> = {};
    for (const k of graphKeys) vals[k] = settings[k];
    setLocal(vals);
    setDirty(false);
  }, [settings]);

  const set = (key: string, value: any) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setError(null);
  };

  const save = async () => {
    try {
      await updateSettings(local);
      setDirty(false);
      showToast("Settings saved");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reset = async () => {
    await resetSettings(graphKeys);
    setError(null);
  };

  const colors: string[] = local["graph.agentColors"] ?? [];

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded border border-red-200">
          {error}
        </div>
      )}

      {/* Data Loading */}
      <section>
        <h3 className="text-sm font-medium mb-3">Data Loading</h3>
        <div className="space-y-2">
          <NumberField settingKey="graph.maxEvents" value={local["graph.maxEvents"] ?? 2500} onChange={(v) => set("graph.maxEvents", v)} />
        </div>
      </section>

      {/* Agent Colors */}
      <section>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-1">
          Agent Colors <Tooltip text={SETTINGS_REGISTRY["graph.agentColors"]?.tooltip} />
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {colors.map((c, i) => (
            <div key={i} className="relative group flex items-center gap-1">
              <ColorSwatch
                color={c}
                onChange={(hex) => {
                  const next = [...colors];
                  next[i] = hex;
                  set("graph.agentColors", next);
                }}
              />
              {colors.length > 1 && (
                <button
                  onClick={() => {
                    const next = colors.filter((_, j) => j !== i);
                    set("graph.agentColors", next);
                  }}
                  className="text-xs text-muted hover:text-red-500 hidden group-hover:inline"
                  title="Remove color"
                >
                  &#10005;
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => set("graph.agentColors", [...colors, "#888888"])}
            className="w-6 h-6 rounded border border-dashed border-border text-muted hover:border-primary hover:text-primary flex items-center justify-center text-sm"
          >
            +
          </button>
        </div>
      </section>

      {/* Main Color */}
      <section>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-1">
          Main Session Color <Tooltip text={SETTINGS_REGISTRY["graph.mainColor"]?.tooltip} />
        </h3>
        <div className="flex items-center gap-2">
          <ColorSwatch
            color={local["graph.mainColor"] ?? "#003864"}
            onChange={(hex) => set("graph.mainColor", hex)}
          />
          <input
            type="text"
            value={local["graph.mainColor"] ?? ""}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) set("graph.mainColor", e.target.value);
            }}
            className="rounded border border-border px-2 py-1 text-sm font-mono w-24 focus:border-primary focus:outline-none"
          />
        </div>
      </section>

      {/* Continuous Simulation Toggle */}
      <section>
        <label className="relative inline-flex items-center cursor-pointer gap-2">
          <input
            type="checkbox"
            className="sr-only"
            checked={local["graph.continuousSimulation"] ?? false}
            onChange={(e) => set("graph.continuousSimulation", e.target.checked)}
          />
          <div className={`w-10 h-5 rounded-full transition-colors ${local["graph.continuousSimulation"] ? "bg-primary" : "bg-border"}`}>
            <div className={`w-4 h-4 rounded-full bg-white shadow mt-0.5 transition-transform ${local["graph.continuousSimulation"] ? "translate-x-5.5" : "translate-x-0.5"}`} />
          </div>
          <span className="text-sm">
            Continuous Simulation <Tooltip text={SETTINGS_REGISTRY["graph.continuousSimulation"]?.tooltip} />
          </span>
        </label>
      </section>

      {/* Force Simulation */}
      <section>
        <h3 className="text-sm font-medium mb-3">Force Simulation</h3>
        <div className="space-y-2">
          <NumberField settingKey="graph.linkDistance" value={local["graph.linkDistance"] ?? 150} onChange={(v) => set("graph.linkDistance", v)} />
          <NumberField settingKey="graph.chargeStrength" value={local["graph.chargeStrength"] ?? -300} onChange={(v) => set("graph.chargeStrength", v)} />
          <NumberField settingKey="graph.collideRadius" value={local["graph.collideRadius"] ?? 50} onChange={(v) => set("graph.collideRadius", v)} />
          <NumberField settingKey="graph.alphaDecay" value={local["graph.alphaDecay"] ?? 0.05} onChange={(v) => set("graph.alphaDecay", v)} />
        </div>
      </section>

      {/* Links */}
      <section>
        <h3 className="text-sm font-medium mb-3">Link Appearance</h3>
        <div className="space-y-2">
          <NumberField settingKey="graph.linkThicknessMin" value={local["graph.linkThicknessMin"] ?? 1} onChange={(v) => set("graph.linkThicknessMin", v)} />
          <NumberField settingKey="graph.linkThicknessMax" value={local["graph.linkThicknessMax"] ?? 10} onChange={(v) => set("graph.linkThicknessMax", v)} />
          <NumberField settingKey="graph.opacityDecayMinutes" value={local["graph.opacityDecayMinutes"] ?? 5} onChange={(v) => set("graph.opacityDecayMinutes", v)} />
        </div>
      </section>

      {/* Save / Reset */}
      <div className="flex gap-3 pt-4 border-t border-border">
        <button
          onClick={save}
          disabled={!dirty}
          className="rounded bg-primary px-4 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
        <button
          onClick={reset}
          className="rounded border border-border px-4 py-1.5 text-sm text-muted hover:text-primary-dark hover:border-primary-dark"
        >
          Reset to Defaults
        </button>
      </div>
      {ToastNode}
    </div>
  );
}
