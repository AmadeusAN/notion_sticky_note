import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function focusableItems(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.tabIndex >= 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
}

/** Keep keyboard focus inside a sheet and return it only to a connected opener. */
export function useModalFocus(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  fallbackFocusRef?: RefObject<HTMLElement | null>,
) {
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    const previous = openerRef.current ?? document.activeElement;
    openerRef.current = previous;
    const dialog = dialogRef.current;
    if (!dialog) return;
    (initialFocusRef.current ?? dialog).focus();
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        (focusableItems(dialog)[0] ?? dialog).focus();
      }
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusableItems(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!first || !dialog.contains(current) || current === dialog) {
        event.preventDefault();
        (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", trapTab, true);
    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", trapTab, true);
      // Let the parent remove background inert before returning focus.
      queueMicrotask(() => {
        if (dialog.isConnected) return;
        if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("[inert]")) {
          previous.focus();
        } else {
          fallbackFocusRef?.current?.focus();
        }
      });
    };
  }, [dialogRef, initialFocusRef, fallbackFocusRef]);
}
