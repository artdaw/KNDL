import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router";
import App from "./App";
import LandingPage from "./pages/LandingPage";
import SpecPage from "./pages/SpecPage";
import SpecFullPage from "./pages/SpecFullPage";
import WorkflowPage from "./pages/WorkflowPage";
import McpPage from "./pages/McpPage";
import ExplorerPage from "./pages/ExplorerPage";
import "./styles/tokens.css";

const router = createHashRouter([
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
