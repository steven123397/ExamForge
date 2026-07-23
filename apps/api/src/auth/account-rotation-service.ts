import type { PlatformRepository } from "../repository.js";
import { hashPassword } from "./security.js";
import { assertStrongAccountPassword } from "./password-policy.js";

export interface AccountPasswordRotationCommand {
  username: string;
  password: string;
  actor: string;
}

export type AccountPasswordRotationResult =
  | { status: "not_found" }
  | { status: "rotated"; credentialVersion: number; revokedSessionCount: number };

export class AccountRotationService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async rotate(command: AccountPasswordRotationCommand): Promise<AccountPasswordRotationResult> {
    const username = command.username.trim();
    const actor = command.actor.trim();
    if (!username) {
      throw new Error("Account username is required.");
    }
    if (!actor) {
      throw new Error("Rotation actor is required.");
    }
    assertStrongAccountPassword(command.password, "New account password");

    const user = await this.repository.findAuthUserByUsername(username);
    if (!user) {
      return { status: "not_found" };
    }
    const rotated = await this.repository.rotateAuthUserPassword({
      userId: user.id,
      password: await hashPassword(command.password),
      rotatedAt: this.now().toISOString(),
      actor,
    });
    return rotated
      ? { status: "rotated", ...rotated }
      : { status: "not_found" };
  }
}
