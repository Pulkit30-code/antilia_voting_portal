import "server-only";

import argon2 from "argon2";
import bcrypt from "bcryptjs";

export async function hashPasscode(passcode: string): Promise<string> {
  return argon2.hash(passcode, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPasscode(
  passwordHash: string,
  hashAlgorithm: "argon2id" | "bcrypt",
  passcode: string,
): Promise<boolean> {
  try {
    if (hashAlgorithm === "argon2id") {
      return await argon2.verify(passwordHash, passcode);
    }
    return await bcrypt.compare(passcode, passwordHash);
  } catch {
    return false;
  }
}
