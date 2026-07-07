export type WorkspaceRole = "admin" | "operator" | "viewer";

export const workspaceTokens: Record<WorkspaceRole, string> = {
  admin: process.env.NEXT_PUBLIC_EXAMFORGE_ADMIN_TOKEN ?? "examforge-admin-token",
  operator: process.env.NEXT_PUBLIC_EXAMFORGE_OPERATOR_TOKEN ?? "examforge-operator-token",
  viewer: process.env.NEXT_PUBLIC_EXAMFORGE_VIEWER_TOKEN ?? "examforge-viewer-token",
};

export function roleHeaders(
  role: WorkspaceRole,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...extra,
    authorization: `Bearer ${workspaceTokens[role]}`,
  };
}
