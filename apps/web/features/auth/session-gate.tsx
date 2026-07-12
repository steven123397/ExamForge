"use client";

import { LogIn } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AuthContext } from "@examforge/shared";
import { OperationsConsole } from "../../app/operations-console";
import { ApiClientError, apiClient } from "../../lib/api-client";

export function SessionGate() {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthContext | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const expire = () => {
      queryClient.clear();
      setAuth(null);
      setRestoring(false);
    };
    window.addEventListener("examforge:session-expired", expire);
    void apiClient.getSession()
      .then((context) => {
        if (active) {
          setAuth(context);
        }
      })
      .catch((reason) => {
        if (active && (!(reason instanceof ApiClientError) || reason.status !== 401)) {
          setError(reason instanceof Error ? reason.message : "会话恢复失败");
        }
      })
      .finally(() => {
        if (active) {
          setRestoring(false);
        }
      });
    return () => {
      active = false;
      window.removeEventListener("examforge:session-expired", expire);
    };
  }, [queryClient]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const context = await apiClient.login(username, password);
      queryClient.clear();
      setAuth(context);
      setPassword("");
    } catch (reason) {
      setError(
        reason instanceof ApiClientError && reason.status === 401
          ? "用户名或密码错误"
          : reason instanceof ApiClientError && reason.status === 403
            ? "账户已停用"
            : reason instanceof Error ? reason.message : "登录失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try {
      await apiClient.logout();
    } finally {
      queryClient.clear();
      setAuth(null);
    }
  }

  if (restoring) {
    return <main className="session-loading" aria-live="polite">正在恢复会话...</main>;
  }

  if (!auth) {
    return (
      <main className="login-shell">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="brand login-brand">
            <div className="brand-mark">EF</div>
            <div>
              <strong>ExamForge</strong>
              <span>Scheduling Operations</span>
            </div>
          </div>
          <div>
            <p className="eyebrow">Secure workspace</p>
            <h1 id="login-title">登录排考运营台</h1>
          </div>
          <form onSubmit={login} className="login-form">
            <label>
              <span>用户名</span>
              <input
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label>
              <span>密码</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error ? <div className="alert" role="alert">{error}</div> : null}
            <button type="submit" className="primary-button" disabled={submitting}>
              <LogIn size={18} />
              {submitting ? "登录中" : "登录"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <OperationsConsole auth={auth} onLogout={logout} />;
}
