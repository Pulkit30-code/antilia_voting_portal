import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { authService } from "@/lib/auth/service";
import type { AdminSession } from "@/lib/auth/types";

async function sessionTokenFromCookies(): Promise<string | undefined> {
  return (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
}

export async function getCurrentSession(): Promise<AdminSession | null> {
  return authService.getSession(await sessionTokenFromCookies());
}

export async function requireAdmin(redirectTo?: string): Promise<AdminSession> {
  const session = await getCurrentSession();
  if (!session) {
    if (redirectTo) redirect(redirectTo);
    return authService.requireRole(undefined, "HR");
  }
  return session;
}

export async function requireHR(redirectTo?: string): Promise<AdminSession> {
  const token = await sessionTokenFromCookies();
  try {
    return await authService.requireRole(token, "HR");
  } catch (error) {
    if (redirectTo) redirect(redirectTo);
    throw error;
  }
}

export async function requireSystem(redirectTo?: string): Promise<AdminSession> {
  const token = await sessionTokenFromCookies();
  try {
    return await authService.requireRole(token, "SYSTEM");
  } catch (error) {
    if (redirectTo) redirect(redirectTo);
    throw error;
  }
}
