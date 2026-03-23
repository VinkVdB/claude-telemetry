import { useState, useEffect } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import { SETTINGS_REGISTRY } from "@shared/settings-defaults";
import { Tooltip } from "../../components/ui/Tooltip";
import { useToast } from "../../hooks/useToast";

interface ModelRates {
  inputPerMToken: number;
  outputPerMToken: number;
  cacheReadPerMToken: number;
  cacheWritePerMToken: number;
}

type Errors = Record<string, string>;

const RATE_FIELDS: { key: keyof ModelRates; label: string }[] = [
  { key: "inputPerMToken", label: "INPUT" },
  { key: "outputPerMToken", label: "OUTPUT" },
  { key: "cacheReadPerMToken", label: "CACHE READ" },
  { key: "cacheWritePerMToken", label: "CACHE WRITE" },
];

const EMPTY_RATES: ModelRates = {
  inputPerMToken: 0,
  outputPerMToken: 0,
  cacheReadPerMToken: 0,
  cacheWritePerMToken: 0,
};

export function PricingTab() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [models, setModels] = useState<Record<string, ModelRates>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    setModels(structuredClone(settings["pricing.models"] ?? {}));
    setDirty(false);
    setErrors({});
    setAdding(false);
  }, [settings["pricing.models"]]);

  const updateRate = (model: string, field: keyof ModelRates, value: string) => {
    const num = parseFloat(value);
    const errKey = `${model}.${field}`;
    if (value === "") {
      setModels((prev) => ({ ...prev, [model]: { ...prev[model], [field]: 0 } }));
      setErrors((prev) => { const n = { ...prev }; delete n[errKey]; return n; });
      setDirty(true);
      return;
    }
    if (isNaN(num) || num < 0) {
      setErrors((prev) => ({ ...prev, [errKey]: "Must be >= 0" }));
      return;
    }
    setModels((prev) => ({ ...prev, [model]: { ...prev[model], [field]: num } }));
    setErrors((prev) => { const n = { ...prev }; delete n[errKey]; return n; });
    setDirty(true);
  };

  const addModel = () => {
    const name = newName.trim();
    if (!name) {
      setErrors((prev) => ({ ...prev, "new-model-name": "Model name cannot be empty" }));
      return;
    }
    if (models[name]) {
      setErrors((prev) => ({ ...prev, "new-model-name": `"${name}" already exists` }));
      return;
    }
    setModels((prev) => ({ ...prev, [name]: { ...EMPTY_RATES } }));
    setNewName("");
    setAdding(false);
    setDirty(true);
    setErrors((prev) => { const n = { ...prev }; delete n["new-model-name"]; return n; });
  };

  const removeModel = (name: string) => {
    setModels((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setDirty(true);
  };

  const { showToast, ToastNode } = useToast();

  const save = async () => {
    try {
      await updateSettings({ "pricing.models": models });
      setDirty(false);
      setErrors({});
      showToast("Settings saved");
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, _save: e.message }));
    }
  };

  const reset = async () => {
    await resetSettings(["pricing.models"]);
    setErrors({});
  };

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-primary"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Model Pricing Rates
          <Tooltip text={SETTINGS_REGISTRY["pricing.models"]?.tooltip} />
        </h2>
        <button
          onClick={() => { setAdding(true); setNewName(""); }}
          className="bg-primary text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-primary/90"
        >
          + Add Model
        </button>
      </div>

      {errors._save && (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded border border-red-200">
          {errors._save}
        </div>
      )}

      {/* Add Model Form */}
      {adding && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1 mr-3">
                <input
                  type="text"
                  placeholder="Enter model name..."
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setErrors((prev) => { const n = { ...prev }; delete n["new-model-name"]; return n; });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && addModel()}
                  autoFocus
                  className="border border-border rounded-md px-2 py-1.5 text-sm font-mono text-primary-dark w-full focus:border-primary focus:outline-none"
                />
                {errors["new-model-name"] && (
                  <p className="text-red-500 text-xs mt-1">{errors["new-model-name"]}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addModel}
                  className="bg-primary text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-primary/90"
                >
                  Add
                </button>
                <button
                  onClick={() => { setAdding(false); setErrors((prev) => { const n = { ...prev }; delete n["new-model-name"]; return n; }); }}
                  className="bg-white text-muted border border-border px-3 py-1.5 rounded-lg text-sm hover:text-primary-dark"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Model Cards */}
      <div className="space-y-4">
        {Object.entries(models).map(([name, rates]) => (
          <div key={name} className="border border-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">{name}</span>
                <button
                  onClick={() => removeModel(name)}
                  className="text-red-500 text-xs cursor-pointer hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-4 gap-3">
                {RATE_FIELDS.map(({ key, label }) => {
                  const errKey = `${name}.${key}`;
                  return (
                    <label key={key} className="block">
                      <span className="text-[10px] uppercase text-muted font-medium tracking-wide">
                        {label}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rates[key]}
                        onChange={(e) => updateRate(name, key, e.target.value)}
                        className={`mt-1 block border rounded-md px-2 py-1.5 text-sm font-mono text-primary-dark w-full focus:border-primary focus:outline-none ${
                          errors[errKey] ? "border-red-400" : "border-border"
                        }`}
                      />
                      {errors[errKey] && (
                        <p className="text-red-500 text-xs mt-1">{errors[errKey]}</p>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Save bar */}
      <div className="flex justify-between items-center p-3 bg-muted/5 rounded-xl border border-border mt-4">
        <span className="text-xs text-muted">
          USD per 1M tokens. Changes apply to new events only — existing costs are not recalculated.
        </span>
        <div className="flex gap-2 shrink-0 ml-3">
          <button
            onClick={reset}
            className="bg-white text-muted border border-border px-4 py-1.5 rounded-lg text-sm hover:text-primary-dark hover:border-primary-dark"
          >
            Reset to Defaults
          </button>
          <button
            onClick={save}
            disabled={!dirty || hasErrors}
            className="bg-primary text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
      {ToastNode}
    </div>
  );
}
