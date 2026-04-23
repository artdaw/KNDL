import "@testing-library/jest-dom";

// Stub requestAnimationFrame for tests
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(performance.now()), 0);
  return 0;
};
globalThis.cancelAnimationFrame = () => {};

// Stub ResizeObserver
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
