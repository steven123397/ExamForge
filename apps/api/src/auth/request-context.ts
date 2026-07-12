import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthContext } from "@examforge/shared";

const authContextStorage = new AsyncLocalStorage<AuthContext>();

export function runWithAuthContext(context: AuthContext, callback: () => void) {
  authContextStorage.run(context, callback);
}

export function getCurrentAuthContext() {
  return authContextStorage.getStore() ?? null;
}
