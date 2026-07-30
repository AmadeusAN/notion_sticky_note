/** Module store so canvas sims can read appearance without React. */

import {
  buildAppearance,
  DEFAULT_FX_APPEARANCE,
  type FxAppearance,
} from "./appearance";

type Listener = (a: FxAppearance) => void;

let current: FxAppearance = { ...DEFAULT_FX_APPEARANCE };
const listeners = new Set<Listener>();

export function getFxAppearance(): FxAppearance {
  return current;
}

export function setFxAppearance(partial: Partial<FxAppearance> & { bg?: string }) {
  current = buildAppearance({ ...current, ...partial, bg: partial.bg ?? current.bg });
  for (const fn of listeners) fn(current);
  return current;
}

export function subscribeFxAppearance(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
