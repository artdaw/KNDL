import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router";
import App from "./App";
import LandingPage from "./pages/LandingPage";
import ProtocolPage from "./pages/ProtocolPage";
import SkillPage from "./pages/SkillPage";
import ExamplesPage from "./pages/ExamplesPage";
import ExplorerPage from "./pages/ExplorerPage";
import McpPage from "./pages/McpPage";
import EvalPage from "./pages/EvalPage";
import "./styles/tokens.css";

// GitHub Pages SPA fallback: 404.html stashes the intended path in
// sessionStorage and redirects to '/'. Here we replay it before the
// router reads window.location.
const redirectedPath = sessionStorage.getItem("kndl:redirect");
if (redirectedPath) {
  sessionStorage.removeItem("kndl:redirect");
  if (redirectedPath !== window.location.pathname + window.location.search) {
    window.history.replaceState(null, "", redirectedPath);
  }
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: "protocol",  element: <ProtocolPage /> },
      { path: "skill",     element: <SkillPage /> },
      { path: "examples",  element: <ExamplesPage /> },
      { path: "explorer",  element: <ExplorerPage /> },
      { path: "mcp",       element: <McpPage /> },
      { path: "eval",      element: <EvalPage /> },
      // Redirects from v1 routes
      { path: "spec",      element: <Navigate to="/protocol" replace /> },
      { path: "spec/full", element: <Navigate to="/protocol" replace /> },
      { path: "workflow",  element: <Navigate to="/skill" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
