// The demo lets QA switch the signed-in user (Sam by default, Maya for admin flows).
// Stored in localStorage so it survives reloads.

const KEY = "selfhub.demoUser";
export const DEMO_USERS = ["sam", "maya"] as const;
export type DemoUser = (typeof DEMO_USERS)[number];

let current: DemoUser | null = null;
const listeners = new Set<() => void>();

export function getDemoUser(): DemoUser {
  if (current) return current;
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(KEY);
    current = stored === "maya" ? "maya" : "sam";
    return current;
  }
  return "sam";
}

export function setDemoUser(user: DemoUser) {
  current = user;
  window.localStorage.setItem(KEY, user);
  listeners.forEach((l) => l());
}

export function subscribeDemoUser(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server snapshot for useSyncExternalStore: the server can't read localStorage. */
export const serverDemoUser = (): DemoUser => "sam";
