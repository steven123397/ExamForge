"use client";

import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import { useAuth } from "./auth-provider";
import { defaultRouteForRoles, safeReturnTo } from "./routing";

export function LoginForm() {
  const router = useRouter();
  const { status, auth, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" && auth) {
      router.replace(loginDestination(auth.user.roles));
    }
  }, [auth, router, status]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const context = await login(username, password);
      setPassword("");
      router.replace(loginDestination(context.user.roles));
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

  if (status === "restoring" || status === "authenticated") {
    return <div className="login-progress" aria-live="polite">正在进入工作区</div>;
  }

  return (
    <form onSubmit={submit} className="login-form" aria-busy={submitting}>
      <label>
        <span>用户名</span>
        <input
          name="username"
          autoComplete="username"
          spellCheck={false}
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
        <LogIn size={18} aria-hidden="true" />
        {submitting ? "登录中…" : "登录"}
      </button>
    </form>
  );
}

function loginDestination(roles: Parameters<typeof defaultRouteForRoles>[0]) {
  const fallback = defaultRouteForRoles(roles);
  if (typeof window === "undefined") return fallback;
  return safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"), fallback);
}
