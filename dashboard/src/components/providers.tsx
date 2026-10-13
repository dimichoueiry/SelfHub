"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppStateProvider } from "@/components/app-state";
import { isApiError } from "@/lib/api/errors";
import { subscribeDemoUser } from "@/lib/demo-user";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Don't retry what retrying can't fix (403, 404, 409).
            retry: (count, error) => !(isApiError(error) && error.status >= 400 && error.status < 500) && count < 2,
          },
        },
      }),
  );

  // Switching the demo user changes every answer the API gives.
  useEffect(() => {
    const unsubscribe = subscribeDemoUser(() => client.resetQueries());
    return () => {
      unsubscribe();
    };
  }, [client]);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={350} skipDelayDuration={150}>
          <AppStateProvider>{children}</AppStateProvider>
          <Toaster position="bottom-right" closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
