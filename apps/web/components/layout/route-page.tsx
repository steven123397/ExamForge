import type { ReactNode } from "react";
import { RouteGuard } from "../../features/auth/route-guard";
import { AudienceShell } from "./audience-shell";
import { OperationsShell } from "./operations-shell";

export function OperationsRoutePage({
  title,
  context,
  children,
}: {
  title: string;
  context: string;
  children?: ReactNode;
}) {
  return (
    <RouteGuard>
      <OperationsShell>
        <PageHeading title={title} context={context} />
        {children ?? <RouteFrame />}
      </OperationsShell>
    </RouteGuard>
  );
}

export function AudienceRoutePage({
  title,
  context,
  children,
}: {
  title: string;
  context: string;
  children?: ReactNode;
}) {
  return (
    <RouteGuard>
      <AudienceShell>
        <PageHeading title={title} context={context} />
        {children ?? <RouteFrame />}
      </AudienceShell>
    </RouteGuard>
  );
}

export function PageHeading({ title, context }: { title: string; context: string }) {
  return (
    <header className="route-heading">
      <p>{context}</p>
      <h1>{title}</h1>
    </header>
  );
}

function RouteFrame() {
  return (
    <div className="route-frame" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
