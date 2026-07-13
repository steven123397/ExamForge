import type { UserRole } from "@examforge/shared";

const routeRules: Array<{ matches(pathname: string): boolean; roles: UserRole[] }> = [
  { matches: (path) => path === "/admin/overview", roles: ["admin", "operator"] },
  { matches: (path) => path === "/admin/reference-data", roles: ["admin", "operator"] },
  { matches: (path) => path === "/scheduling/jobs", roles: ["admin", "operator"] },
  { matches: (path) => path === "/scheduling/runs", roles: ["admin", "operator"] },
  { matches: (path) => path.startsWith("/scheduling/drafts/"), roles: ["admin", "operator"] },
  { matches: (path) => path === "/scheduling/policies", roles: ["admin", "operator"] },
  { matches: (path) => path === "/audit", roles: ["admin"] },
  { matches: (path) => path === "/teacher/schedule", roles: ["teacher"] },
  { matches: (path) => path === "/student/schedule", roles: ["student"] },
];

export function defaultRouteForRoles(roles: UserRole[]) {
  if (roles.includes("admin")) return "/admin/overview";
  if (roles.includes("operator")) return "/scheduling/jobs";
  if (roles.includes("teacher")) return "/teacher/schedule";
  if (roles.includes("student")) return "/student/schedule";
  return "/login";
}

export function canAccessRoute(roles: UserRole[], pathname: string) {
  const rule = routeRules.find((candidate) => candidate.matches(pathname));
  return rule ? roles.some((role) => rule.roles.includes(role)) : false;
}

export function safeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "http://examforge.local");
    if (parsed.origin !== "http://examforge.local" || parsed.pathname === "/login") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function clearPrivateSessionState(
  clearQueryCache: () => void,
  publishAnonymous: () => void,
) {
  clearQueryCache();
  publishAnonymous();
}
