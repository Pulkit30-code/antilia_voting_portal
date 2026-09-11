import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { ADMIN_SESSION_TOKEN_BYTES } from "@/lib/auth/constants";

export function createOpaqueSessionToken(): string {
  return randomBytes(ADMIN_SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

export function fingerprintRequestValue(
  value: string,
  purpose: "ip" | "user-agent",
  pepper: string,
): Uint8Array {
  return createHmac("sha256", pepper)
    .update(`${purpose}\0${value}`, "utf8")
    .digest();
}
