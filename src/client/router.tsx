import { createBrowserRouter } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { RawExplorerPage } from "./pages/RawExplorerPage";

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <ProjectsPage /> },
      { path: "/projects/:id", element: <ProjectDetailPage /> },
      { path: "/sessions/:id", element: <SessionDetailPage /> },
      { path: "/raw", element: <RawExplorerPage /> },
    ],
  },
]);
