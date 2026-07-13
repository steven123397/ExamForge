"use client";

import {
  Activity,
  BookOpenCheck,
  ClipboardList,
  Database,
  FileClock,
  Gauge,
  History,
  Scale,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../features/auth/auth-provider";

const items = [
  { href: "/admin/overview", label: "运行概览", icon: Gauge, roles: ["admin", "operator"] },
  { href: "/admin/reference-data", label: "基础数据", icon: Database, roles: ["admin", "operator"] },
  { href: "/scheduling/jobs", label: "调度任务", icon: Activity, roles: ["admin", "operator"] },
  { href: "/scheduling/runs", label: "运行历史", icon: History, roles: ["admin", "operator"] },
  { href: "/scheduling/policies", label: "约束策略", icon: Scale, roles: ["admin", "operator"] },
  { href: "/audit", label: "审计追踪", icon: FileClock, roles: ["admin"] },
] as const;

export function OperationsNavigation({ onNavigate }: { onNavigate?(): void }) {
  const pathname = usePathname();
  const { auth } = useAuth();
  return (
    <nav className="operations-nav" aria-label="运营导航">
      <div className="nav-group-label">控制面</div>
      {items.filter((item) => item.roles.some((role) => auth?.user.roles.includes(role))).map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href
          || (item.href === "/scheduling/runs" && pathname.startsWith("/scheduling/drafts/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`operations-nav-item${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <div className="nav-group-label nav-group-secondary">关联入口</div>
      <Link className="operations-nav-item" href="/scheduling/jobs" onClick={onNavigate}>
        <ClipboardList size={18} aria-hidden="true" />
        <span>当前批次</span>
      </Link>
      <Link className="operations-nav-item" href="/scheduling/policies" onClick={onNavigate}>
        <BookOpenCheck size={18} aria-hidden="true" />
        <span>生效规则</span>
      </Link>
    </nav>
  );
}
