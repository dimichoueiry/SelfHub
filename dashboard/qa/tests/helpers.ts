import type { Page } from "@playwright/test";

export async function as(page: Page, user: "sam" | "maya", theme: "light" | "dark" = "light") {
  await page.addInitScript(
    ([u, t]) => {
      window.localStorage.setItem("selfhub.demoUser", u);
      window.localStorage.setItem("theme", t);
    },
    [user, theme] as const,
  );
}

export const toast = (page: Page, text: string | RegExp) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
