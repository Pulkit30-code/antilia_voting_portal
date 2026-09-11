import "server-only";

export function isSetupModeEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}
