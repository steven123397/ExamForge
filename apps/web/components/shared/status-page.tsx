"use client";

import { ArrowLeft, RotateCcw } from "lucide-react";
import Link from "next/link";

export function StatusPage({
  code,
  title,
  detail,
  href,
  actionLabel,
  onAction,
}: {
  code: string;
  title: string;
  detail: string;
  href?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="status-page">
      <div className="status-code" aria-hidden="true">{code}</div>
      <h1>{title}</h1>
      <p>{detail}</p>
      {href && actionLabel ? (
        <Link className="secondary-button" href={href}>
          <ArrowLeft size={17} aria-hidden="true" />
          {actionLabel}
        </Link>
      ) : null}
      {onAction && actionLabel ? (
        <button className="secondary-button" type="button" onClick={onAction}>
          <RotateCcw size={17} aria-hidden="true" />
          {actionLabel}
        </button>
      ) : null}
    </main>
  );
}
