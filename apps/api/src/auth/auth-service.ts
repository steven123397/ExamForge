import type { AuthContext } from "@examforge/shared";
import { randomUUID } from "node:crypto";
import type { PlatformRepository } from "../repository.js";
import {
  createSessionToken,
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
  | { status: "authenticated"; token: string; context: AuthContext };

export class AuthService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly sessionTtlMs = 12 * 60 * 60 * 1000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(username: string, password: string, metadata: LoginMetadata): Promise<LoginResult> {
    const user = await this.repository.findAuthUserByUsername(username);
    const validPassword = await verifyPassword(
      password,
      user?.password ?? await dummyPasswordHash,
    );
    if (!user || !validPassword) {
      return { status: "invalid_credentials" };
    }
    if (!user.active) {
      return { status: "disabled" };
    }

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
    });
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
