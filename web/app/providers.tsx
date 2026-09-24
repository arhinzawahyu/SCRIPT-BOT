"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "wa-toast",
            title: "wa-toast-title",
            description: "wa-toast-description",
            actionButton: "wa-toast-action",
            error: "wa-toast-error",
            success: "wa-toast-success",
          },
        }}
      />
    </QueryClientProvider>
  );
}
