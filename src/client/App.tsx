import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { SettingsProvider } from "./contexts/SettingsContext";

export function App() {
  return (
    <SettingsProvider>
      <RouterProvider router={router} />
    </SettingsProvider>
  );
}
