"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

interface AppState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** What had focus when the palette opened, so Escape can return there. */
  paletteOpener: React.RefObject<HTMLElement | null>;
  /** Mark that a palette result navigated away (focus then goes to the page, not the opener). */
  markPaletteNavigated: () => void;
  /** Read and clear that mark. */
  takePaletteNavigated: () => boolean;
  addSpaceOpen: boolean;
  setAddSpaceOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  /** Set by the editor while there are unsaved changes; the shell guards navigation. */
  dirty: React.RefObject<boolean>;
  setDirty: (dirty: boolean) => void;
  /** Run `action` now, or after the user confirms discarding unsaved changes. */
  guard: (action: () => void) => void;
  pendingAction: (() => void) | null;
  resolvePending: (proceed: boolean) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpenState] = useState(false);
  const paletteOpener = useRef<HTMLElement | null>(null);
  const paletteNavigated = useRef(false);
  const markPaletteNavigated = useCallback(() => {
    paletteNavigated.current = true;
  }, []);
  const takePaletteNavigated = useCallback(() => {
    const v = paletteNavigated.current;
    paletteNavigated.current = false;
    return v;
  }, []);
  const setPaletteOpen = useCallback((open: boolean) => {
    if (open) paletteOpener.current = document.activeElement as HTMLElement | null;
    setPaletteOpenState(open);
  }, []);
  const [addSpaceOpen, setAddSpaceOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const dirty = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  const guard = useCallback((action: () => void) => {
    if (dirty.current) setPendingAction(() => action);
    else action();
  }, []);

  const resolvePending = useCallback(
    (proceed: boolean) => {
      const action = pendingAction;
      setPendingAction(null);
      if (proceed && action) {
        dirty.current = false;
        action();
      }
    },
    [pendingAction],
  );

  const value = useMemo(
    () => ({
      paletteOpen,
      setPaletteOpen,
      paletteOpener,
      markPaletteNavigated,
      takePaletteNavigated,
      addSpaceOpen,
      setAddSpaceOpen,
      mobileNavOpen,
      setMobileNavOpen,
      dirty,
      setDirty,
      guard,
      pendingAction,
      resolvePending,
    }),
    [paletteOpen, setPaletteOpen, markPaletteNavigated, takePaletteNavigated, addSpaceOpen, mobileNavOpen, setDirty, guard, pendingAction, resolvePending],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
