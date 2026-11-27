import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom does not implement HTMLDialogElement.showModal / close
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

// jsdom does not implement matchMedia
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// jsdom does not implement ResizeObserver (used by TanStack Virtual / cmdk)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement Element.prototype.scrollIntoView (used by cmdk)
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom returns 0 for layout geometry; provide non-zero defaults so @tanstack/react-virtual renders rows
if (typeof HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: 1000,
  });
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: 1000,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

// Mock Plotly WebGL bundle so EmbeddingScatterPlot renders cleanly in jsdom
vi.mock("plotly.js-dist-min", () => {
  const mockEl = { removeAllListeners: vi.fn(), on: vi.fn() };
  return {
    default: {
      newPlot: vi.fn().mockResolvedValue(mockEl),
      react: vi.fn().mockResolvedValue(mockEl),
      purge: vi.fn(),
    },
  };
});

// Mock Tauri native dialog & updater plugins
export const mockDialogOpen = vi.fn().mockResolvedValue(null);
export const mockDialogSave = vi.fn().mockResolvedValue(null);
export const mockUpdaterCheck = vi.fn().mockResolvedValue(null);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockDialogOpen(...args),
  save: (...args: unknown[]) => mockDialogSave(...args),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => mockUpdaterCheck(...args),
}));
