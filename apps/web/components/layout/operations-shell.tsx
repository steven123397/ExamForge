"use client";

import { CalendarDays, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { OperationsNavigation } from "./navigation";
import { SessionMenu } from "./session-menu";

export function OperationsShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="operations-layout">
      <aside className={`operations-rail${open ? " open" : ""}`}>
        <div className="rail-brand">
          <div className="brand-mark" aria-hidden="true">EF</div>
          <div>
            <strong>ExamForge</strong>
            <span>排考控制面</span>
          </div>
          <button
            type="button"
            className="rail-close"
            aria-label="关闭导航"
            title="关闭导航"
            onClick={() => setOpen(false)}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <OperationsNavigation onNavigate={() => setOpen(false)} />
      </aside>
      {open ? <button className="rail-backdrop" aria-label="关闭导航" onClick={() => setOpen(false)} /> : null}
      <div className="operations-stage">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-button mobile-nav-trigger"
            aria-label="打开导航"
            title="打开导航"
            onClick={() => setOpen(true)}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <Link className="batch-context" href="/admin/overview">
            <CalendarDays size={18} aria-hidden="true" />
            <span>当前批次</span>
            <strong>2026 春季期末考试</strong>
          </Link>
          <SessionMenu />
        </header>
        <main className="route-workspace" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
