import { useSyncExternalStore } from "react";

const queries = [
  "(prefers-reduced-motion: reduce)",
  "(prefers-reduced-transparency: reduce)",
  "(prefers-contrast: more)",
  "(forced-colors: active)",
];
const DOCUMENT_HIDDEN = 1 << queries.length;
const MEDIA_MASK = DOCUMENT_HIDDEN - 1;
let media: MediaQueryList[] | undefined;
const subscribers = new Set<() => void>();

function mediaQueries() {
  if (!media) media = queries.map((query) => window.matchMedia(query));
  return media;
}
function notify() { for (const subscriber of subscribers) subscriber(); }
function flags() {
  let value = 0;
  mediaQueries().forEach((query, index) => { if (query.matches) value |= 1 << index; });
  if (document.hidden) value |= DOCUMENT_HIDDEN;
  return value;
}
function subscribe(subscriber: () => void) {
  if (subscribers.size === 0) {
    for (const query of mediaQueries()) query.addEventListener("change", notify);
    document.addEventListener("visibilitychange", notify);
  }
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      for (const query of mediaQueries()) query.removeEventListener("change", notify);
      document.removeEventListener("visibilitychange", notify);
    }
  };
}

export function useFxActivityPolicy() {
  const value = useSyncExternalStore(subscribe, flags, () => 0);
  return { mediaAllowed: (value & MEDIA_MASK) === 0, documentVisible: (value & DOCUMENT_HIDDEN) === 0 };
}
