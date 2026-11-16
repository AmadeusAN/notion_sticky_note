import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFxActivityPolicy } from "./media";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const queries = new Map<string, { matches: boolean; listeners: Set<() => void>; addEventListener: (_: string, listener: () => void) => void; removeEventListener: (_: string, listener: () => void) => void }>();
let hidden = false;
let root: Root;
let container: HTMLDivElement;
let policy: { mediaAllowed: boolean; documentVisible: boolean };
const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");

function Probe() {
  policy = useFxActivityPolicy();
  return null;
}

beforeEach(async () => {
  hidden = false;
  for (const query of queries.values()) query.matches = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.stubGlobal("matchMedia", (name: string) => {
    let query = queries.get(name);
    if (!query) {
      const listeners = new Set<() => void>();
      query = { matches: false, listeners,
        addEventListener: (_, listener) => { listeners.add(listener); },
        removeEventListener: (_, listener) => { listeners.delete(listener); } };
      queries.set(name, query);
    }
    return query as unknown as MediaQueryList;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else Reflect.deleteProperty(document, "hidden");
  vi.unstubAllGlobals();
});

for (const name of ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)", "(forced-colors: active)"]) {
  it(`${name} blocks motion without pretending that the document is hidden`, async () => {
    const query = queries.get(name)!;
    await act(async () => { query.matches = true; for (const listener of query.listeners) listener(); });
    expect(policy).toEqual({ mediaAllowed: false, documentVisible: true });
    await act(async () => { query.matches = false; for (const listener of query.listeners) listener(); });
    expect(policy).toEqual({ mediaAllowed: true, documentVisible: true });
  });
}

it("document hiding pauses rendering without blocking the native window from becoming visible again", async () => {
  await act(async () => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  expect(policy).toEqual({ mediaAllowed: true, documentVisible: false });
  await act(async () => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  expect(policy).toEqual({ mediaAllowed: true, documentVisible: true });
});
