// src/client/pages/RawExplorerPage.tsx
import { RawExplorer } from "../components/RawExplorer";

export function RawExplorerPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary-dark mb-6">Raw Data Explorer</h1>
      <RawExplorer />
    </div>
  );
}
