import "server-only";

import { z } from "zod";

import { getPublicEnvironment } from "@/lib/env/public";

const serverEnvironmentSchema = z.object({
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith("sb_secret_"),
      "Use a current Supabase secret key",
    ),
  ANTILIA_RATE_LIMIT_PEPPER: z
    .string()
    .min(32, "ANTILIA_RATE_LIMIT_PEPPER must be at least 32 characters"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema> &
  ReturnType<typeof getPublicEnvironment>;

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= {
    ...getPublicEnvironment(),
    ...serverEnvironmentSchema.parse({
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      ANTILIA_RATE_LIMIT_PEPPER: process.env.ANTILIA_RATE_LIMIT_PEPPER,
    }),
  };
  return cachedEnvironment;
}
