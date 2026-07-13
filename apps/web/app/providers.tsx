"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "../features/auth/auth-provider";
import { ExamForgeQueryClientProvider } from "../lib/query-client-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ExamForgeQueryClientProvider>
      <AuthProvider>{children}</AuthProvider>
    </ExamForgeQueryClientProvider>
  );
}
