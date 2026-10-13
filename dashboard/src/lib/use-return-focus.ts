"use client";

import { useCallback, useRef } from "react";

/**
 * Remember what had focus when an overlay opened, and put focus back there when it closes.
 * Radix only does this for its own Trigger; our overlays are often opened programmatically.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);

  const capture = useCallback((el?: HTMLElement | null) => {
    opener.current = el ?? (document.activeElement as HTMLElement | null);
  }, []);

  /** Use as onCloseAutoFocus. `fallback` is used when the opener is gone (e.g. a removed row). */
  const restore = useCallback((e?: Event, fallback?: () => HTMLElement | null | undefined) => {
    e?.preventDefault();
    const el = opener.current;
    requestAnimationFrame(() => {
      if (el && el.isConnected && el !== document.body) el.focus();
      else fallback?.()?.focus();
    });
  }, []);

  return { capture, restore };
}
