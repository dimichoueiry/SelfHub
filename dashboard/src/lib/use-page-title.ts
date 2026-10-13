"use client";

import { useEffect } from "react";

/** Sets the tab title: "Apex Roofing · brief.md — SelfHub". Pass null while loading. */
export function usePageTitle(...parts: (string | null | undefined | false)[]) {
  const title = parts.filter(Boolean).join(" · ");
  useEffect(() => {
    document.title = title ? `${title} — SelfHub` : "SelfHub";
  }, [title]);
}
