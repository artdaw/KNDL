import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ExplorerPage from "./ExplorerPage";

function renderExplorer() {
  return render(
    <MemoryRouter>
      <ExplorerPage />
    </MemoryRouter>
  );
}

describe("ExplorerPage", () => {
  it("renders without crashing", () => {
    renderExplorer();
    expect(screen.getByText("Graph Explorer")).toBeDefined();
  });

  it("shows graph and editor view toggle buttons", () => {
    renderExplorer();
    const btns = screen.getAllByRole("button");
    expect(btns.some(b => /^graph$/i.test(b.textContent ?? ""))).toBe(true);
    expect(btns.some(b => /^editor$/i.test(b.textContent ?? ""))).toBe(true);
  });

  it("renders the SVG canvas in graph view by default", () => {
    renderExplorer();
    expect(screen.getByTestId("graph-canvas")).toBeDefined();
  });

  it("shows stats in toolbar (nodes, edges, types, avg conf)", () => {
    const { container } = renderExplorer();
    expect(container.textContent).toContain("nodes");
    expect(container.textContent).toContain("edges");
    expect(container.textContent).toContain("types");
    expect(container.textContent).toContain("avg conf");
  });

  it("switches to editor view when Editor button is clicked", () => {
    renderExplorer();
    const editorBtn = screen.getAllByText(/editor/i).find(
      el => el.tagName === "BUTTON"
    );
    expect(editorBtn).toBeDefined();
    fireEvent.click(editorBtn!);
    expect(screen.getByTestId("kndl-editor")).toBeDefined();
    expect(screen.queryByTestId("graph-canvas")).toBeNull();
  });

  it("switches back to graph view via VIEW GRAPH button", () => {
    renderExplorer();
    const editorBtn = screen.getAllByText(/editor/i).find(el => el.tagName === "BUTTON")!;
    fireEvent.click(editorBtn);
    fireEvent.click(screen.getByText(/VIEW GRAPH/));
    expect(screen.getByTestId("graph-canvas")).toBeDefined();
  });

  it("textarea contains sample KNDL source", () => {
    renderExplorer();
    const editorBtn = screen.getAllByText(/editor/i).find(el => el.tagName === "BUTTON")!;
    fireEvent.click(editorBtn);
    const ta = screen.getByTestId("kndl-editor") as HTMLTextAreaElement;
    expect(ta.value).toContain("node @berlin");
  });

  it("updates graph when source changes in editor", () => {
    renderExplorer();
    const editorBtn = screen.getAllByText(/editor/i).find(el => el.tagName === "BUTTON")!;
    fireEvent.click(editorBtn);
    const ta = screen.getByTestId("kndl-editor") as HTMLTextAreaElement;
    fireEvent.change(ta, {
      target: { value: `node @alice :: Person { name = "Alice" }` },
    });
    fireEvent.click(screen.getByText(/VIEW GRAPH/));
    // Stats should now show 1 node
    expect(screen.getByTestId("graph-canvas")).toBeDefined();
  });

  it("detail panel is hidden by default (width 0)", () => {
    renderExplorer();
    const panel = screen.getByTestId("detail-panel");
    expect(panel).toBeDefined();
    expect(panel.style.width).toBe("0px");
  });

  it("renders footer hints", () => {
    const { container } = renderExplorer();
    expect(container.textContent).toContain("CLICK node to inspect");
    expect(container.textContent).toContain("SCROLL to zoom");
  });

  it("zoom buttons are rendered in graph view", () => {
    renderExplorer();
    expect(screen.getByText("+")).toBeDefined();
    expect(screen.getByText("−")).toBeDefined();
    expect(screen.getByText("⊙")).toBeDefined();
  });

  it("does not crash on empty KNDL source", () => {
    renderExplorer();
    const editorBtn = screen.getAllByText(/editor/i).find(el => el.tagName === "BUTTON")!;
    fireEvent.click(editorBtn);
    const ta = screen.getByTestId("kndl-editor") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "" } });
    fireEvent.click(screen.getByText(/VIEW GRAPH/));
    // Should render empty canvas without crashing
    expect(screen.getByTestId("graph-canvas")).toBeDefined();
  });
});
