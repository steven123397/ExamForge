import type { AuthContext } from "@examforge/shared";
import { randomUUID } from "node:crypto";
import type { LoginFailurePolicy, PlatformRepository } from "../repository.js";
import {
  createSessionToken,
  hashLoginAttemptKey,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./security.js";

export interface LoginMetadata {
  userAgent: string | null;
  ipAddress: string | null;
}

export type LoginResult =
  | { status: "invalid_credentials" }
  | { status: "disabled" }
  | { status: "temporarily_locked"; retryAfterSeconds: number }
  | { status: "authenticated"; token: string; context: AuthContext };

const defaultLoginFailurePolicy: LoginFailurePolicy = {
  maxFailures: 5,
  failureWindowMs: 15 * 60 * 1000,
  lockDurationMs: 15 * 60 * 1000,
};

export class AuthService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly sessionTtlMs = 12 * 60 * 60 * 1000,
    private readonly now: () => Date = () => new Date(),
    private readonly loginFailurePolicy: LoginFailurePolicy = defaultLoginFailurePolicy,
  ) {}

  async login(username: string, password: string, metadata: LoginMetadata): Promise<LoginResult> {
    const attemptedAt = this.now();
    const loginKeyDigest = hashLoginAttemptKey(metadata.ipAddress, username);
    const existingLock = await this.repository.getLoginFailureLock(
      loginKeyDigest,
      attemptedAt.toISOString(),
    );
    if (existingLock.locked) {
      return {
        status: "temporarily_locked",
        retryAfterSeconds: existingLock.retryAfterSeconds,
      };
    }

    const user = await this.repository.findAuthUserByUsername(username);
    const validPassword = await verifyPassword(
      password,
      user?.password ?? await dummyPasswordHash,
    );
    if (!user || !validPassword) {
      const failure = await this.repository.recordLoginFailure(
        loginKeyDigest,
        attemptedAt.toISOString(),
        this.loginFailurePolicy,
      );
      if (failure.locked) {
        if (failure.newlyLocked) {
          await this.repository.recordAuditEvent?.(
            "auth.login_temporarily_locked",
            "auth_login_attempt",
            loginKeyDigest,
            {
              failureCount: failure.failureCount,
              retryAfterSeconds: failure.retryAfterSeconds,
            },
            "system",
          );
        }
        return {
          status: "temporarily_locked",
          retryAfterSeconds: failure.retryAfterSeconds,
        };
      }
      return { status: "invalid_credentials" };
    }
    if (!user.active) {
      return { status: "disabled" };
    }

    await this.repository.clearLoginFailures(loginKeyDigest);

    const token = createSessionToken();
    const createdAt = this.now();
    const session = await this.repository.createAuthSession({
      id: `session-${randomUUID()}`,
      userId: user.id,
      tokenDigest: hashSessionToken(token),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.sessionTtlMs).toISOString(),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
      credentialVersion: user.credentialVersion,
    });
    if (!session) {
      return { status: "invalid_credentials" };
    }
    return {
      status: "authenticated",
      token,
      context: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          active: user.active,
          roles: user.roles,
        },
        session: {
          id: session.id,
          userId: session.userId,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      },
    };
  }

  async authenticate(token: string | null): Promise<AuthContext | null> {
    if (!token) {
      return null;
    }
    const record = await this.repository.findAuthSessionByTokenDigest(hashSessionToken(token));
    if (!record
      || !record.user.active
      || record.session.revokedAt
      || record.session.credentialVersion !== record.user.credentialVersion
      || new Date(record.session.expiresAt).getTime() <= this.now().getTime()) {
      return null;
    }
    return {
      user: {
        id: record.user.id,
        username: record.user.username,
        displayName: record.user.displayName,
        active: record.user.active,
        roles: record.user.roles,
      },
      session: {
        id: record.session.id,
        userId: record.session.userId,
        createdAt: record.session.createdAt,
        expiresAt: record.session.expiresAt,
      },
    };
  }

  logout(sessionId: string) {
    return this.repository.revokeAuthSession(sessionId, this.now().toISOString());
  }
}

const dummyPasswordHash = hashPassword("examforge-invalid-credential-sentinel");
