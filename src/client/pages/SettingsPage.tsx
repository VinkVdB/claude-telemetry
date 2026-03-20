import { useState } from "react";
import { cn } from "../lib/utils";
import { PricingTab } from "./settings/PricingTab";
import { GraphTab } from "./settings/GraphTab";
import { ServerTab } from "./settings/ServerTab";
import { DisplayTab } from "./settings/DisplayTab";

const tabs = [
  { id: "pricing", label: "Pricing", component: PricingTab },
  { id: "graph", label: "Graph", component: GraphTab },
  { id: "server", label: "Server", component: ServerTab },
  { id: "display", label: "Display", component: DisplayTab },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("pricing");
  const ActiveComponent = tabs.find((t) => t.id === activeTab)!.component;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary-dark mb-6">Settings</h1>
      <div className="border-b border-border mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "pb-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-primary-dark hover:border-border"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <ActiveComponent />
    </div>
  );
}
