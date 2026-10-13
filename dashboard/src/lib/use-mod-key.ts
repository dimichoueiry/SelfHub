"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const isMac = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple platforms, "Ctrl" elsewhere. The server renders "⌘". */
export function useModKey() {
  return useSyncExternalStore(subscribe, () => (isMac() ? "⌘" : "Ctrl"), () => "⌘");
}
