"use client";

import { LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../features/auth/auth-provider";

export function SessionMenu() {
  const router = useRouter();
  const { auth, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    try {
      await logout();
      router.replace("/login");
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="session-menu" data-testid="session-user">
      <UserRound size={18} aria-hidden="true" />
      <div>
        <strong>{auth?.user.displayName ?? "--"}</strong>
        <span>{auth?.user.roles.join(" / ") ?? "--"}</span>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={() => void leave()}
        aria-label="退出登录"
        title="退出登录"
        disabled={leaving}
      >
        <LogOut size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
