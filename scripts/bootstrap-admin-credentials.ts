import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import argon2 from "argon2";
import { z } from "zod";

import { validatePasscode } from "@/lib/auth/passcode-policy";

loadEnvConfig(process.cwd());

const bootstrapEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().refine((value) => value.startsWith("https://")),
  SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_"),
  ANTILIA_BOOTSTRAP_HR_PASSCODE: z.string(),
  ANTILIA_BOOTSTRAP_SYSTEM_PASSCODE: z.string(),
});

async function hash(passcode: string): Promise<string> {
  return argon2.hash(passcode, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

async function main(): Promise<void> {
  const environment = bootstrapEnvironmentSchema.parse(process.env);
  const hrValidationError = validatePasscode(
    environment.ANTILIA_BOOTSTRAP_HR_PASSCODE,
  );
  const systemValidationError = validatePasscode(
    environment.ANTILIA_BOOTSTRAP_SYSTEM_PASSCODE,
  );
  if (hrValidationError || systemValidationError) {
    throw new Error(
      `Bootstrap passcode policy failed: ${hrValidationError ?? systemValidationError}`,
    );
  }
  if (
    environment.ANTILIA_BOOTSTRAP_HR_PASSCODE ===
    environment.ANTILIA_BOOTSTRAP_SYSTEM_PASSCODE
  ) {
    throw new Error("HR and SYSTEM passcodes must be different");
  }

  const [hrHash, systemHash] = await Promise.all([
    hash(environment.ANTILIA_BOOTSTRAP_HR_PASSCODE),
    hash(environment.ANTILIA_BOOTSTRAP_SYSTEM_PASSCODE),
  ]);
  const supabase = createClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const { error } = await supabase.rpc("antilia_auth_bootstrap", {
    p_hr_password_hash: hrHash,
    p_system_password_hash: systemHash,
    p_hash_algorithm: "argon2id",
  });
  if (error) {
    throw new Error(`Credential bootstrap failed (${error.code})`);
  }

  console.log(
    "Administrative credentials bootstrapped. Remove both ANTILIA_BOOTSTRAP_* variables now.",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(message);
  process.exitCode = 1;
});
