import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import App from "./App";
import LandingPage from "./pages/LandingPage";
import SpecPage from "./pages/SpecPage";
import SpecFullPage from "./pages/SpecFullPage";
import WorkflowPage from "./pages/WorkflowPage";
import McpPage from "./pages/McpPage";
import ExplorerPage from "./pages/ExplorerPage";
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
      { path: "spec", element: <SpecPage /> },
      { path: "spec/full", element: <SpecFullPage /> },
      { path: "workflow", element: <WorkflowPage /> },
      { path: "mcp", element: <McpPage /> },
      { path: "explorer", element: <ExplorerPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
