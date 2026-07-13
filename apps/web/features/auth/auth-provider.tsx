"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthContext } from "@examforge/shared";
import { ApiClientError, apiClient } from "../../lib/api-client";
import { clearPrivateSessionState } from "./routing";

type AuthStatus = "restoring" | "authenticated" | "anonymous" | "error";

interface AuthProviderValue {
  status: AuthStatus;
  auth: AuthContext | null;
  restoreError: string | null;
  login(username: string, password: string): Promise<AuthContext>;
  logout(): Promise<void>;
  restore(): Promise<void>;
}

const AuthProviderContext = createContext<AuthProviderValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [auth, setAuth] = useState<AuthContext | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const publishAnonymous = useCallback(() => {
    setAuth(null);
    setRestoreError(null);
    setStatus("anonymous");
  }, []);

  const expire = useCallback(() => {
    clearPrivateSessionState(() => queryClient.clear(), publishAnonymous);
  }, [publishAnonymous, queryClient]);

  const restore = useCallback(async () => {
    setStatus("restoring");
    setRestoreError(null);
    try {
      const context = await apiClient.getSession();
      setAuth(context);
      setStatus("authenticated");
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) {
        expire();
        return;
      }
      setAuth(null);
      setRestoreError(reason instanceof Error ? reason.message : "会话恢复失败");
      setStatus("error");
    }
  }, [expire]);

  useEffect(() => {
    window.addEventListener("examforge:session-expired", expire);
    void restore();
    return () => window.removeEventListener("examforge:session-expired", expire);
  }, [expire, restore]);

  const value = useMemo<AuthProviderValue>(() => ({
    status,
    auth,
    restoreError,
    async login(username, password) {
      const context = await apiClient.login(username, password);
      queryClient.clear();
      setAuth(context);
      setRestoreError(null);
      setStatus("authenticated");
      return context;
    },
    async logout() {
      try {
        await apiClient.logout();
      } finally {
        expire();
      }
    },
    restore,
  }), [auth, expire, queryClient, restore, restoreError, status]);

  return <AuthProviderContext.Provider value={value}>{children}</AuthProviderContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthProviderContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}
