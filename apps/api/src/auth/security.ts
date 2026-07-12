import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

export interface PasswordHash {
  hash: string;
  salt: string;
  n: number;
  r: number;
  p: number;
  keyLength: number;
}

const defaultScryptParameters = {
  n: 16_384,
  r: 8,
  p: 1,
  keyLength: 64,
} as const;

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, defaultScryptParameters);
  return {
    ...defaultScryptParameters,
    salt: salt.toString("base64"),
    hash: derived.toString("base64"),
  };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const expected = Buffer.from(stored.hash, "base64");
  const actual = await derivePassword(password, Buffer.from(stored.salt, "base64"), stored);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function derivePassword(
  password: string,
  salt: Buffer,
  parameters: Pick<PasswordHash, "n" | "r" | "p" | "keyLength">,
) {
  const options: ScryptOptions = {
    N: parameters.n,
    r: parameters.r,
    p: parameters.p,
    maxmem: 64 * 1024 * 1024,
  };
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, parameters.keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}
