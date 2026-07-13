"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";
import { useAuth } from "../../features/auth/auth-provider";
import { SessionMenu } from "./session-menu";

export function AudienceShell({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const schedulePath = auth?.user.roles.includes("teacher")
    ? "/teacher/schedule"
    : "/student/schedule";
  return (
    <div className="audience-layout">
      <header className="audience-topbar">
        <Link className="audience-brand" href={schedulePath}>
          <span className="brand-mark" aria-hidden="true">EF</span>
          <span>
            <strong>ExamForge</strong>
            <small>考试日程</small>
          </span>
        </Link>
        <nav aria-label="本人任务">
          <Link href={schedulePath}>
            <CalendarDays size={17} aria-hidden="true" />
            我的日程
          </Link>
        </nav>
        <SessionMenu />
      </header>
      <main className="audience-workspace" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
