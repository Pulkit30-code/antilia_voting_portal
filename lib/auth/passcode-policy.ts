import {
  MAXIMUM_PASSCODE_LENGTH,
  MINIMUM_PASSCODE_LENGTH,
} from "@/lib/auth/constants";

const KNOWN_WEAK_PASSCODES = new Set([
  "1234",
  "12345678",
  "admin",
  "admin123",
  "hr1234",
  "password",
  "password1",
  "qwerty123",
  "system1234",
  "letmein123",
  "welcome123",
]);

const OBVIOUS_SEQUENCE = /(?:01234567|12345678|23456789|abcdefgh|qwertyui)/i;
const REPEATED_CHARACTER = /^(.)\1{7,}$/;

export function validatePasscode(passcode: string): string | null {
  if (
    passcode.length < MINIMUM_PASSCODE_LENGTH ||
    passcode.length > MAXIMUM_PASSCODE_LENGTH
  ) {
    return `Passcode must contain between ${MINIMUM_PASSCODE_LENGTH} and ${MAXIMUM_PASSCODE_LENGTH} characters.`;
  }
  if (KNOWN_WEAK_PASSCODES.has(passcode.trim().toLowerCase())) {
    return "Choose a less common administrative passcode.";
  }
  const normalized = passcode.trim().toLowerCase();
  if (
    normalized.length < MINIMUM_PASSCODE_LENGTH ||
    new Set(normalized).size < 4 ||
    OBVIOUS_SEQUENCE.test(normalized) ||
    REPEATED_CHARACTER.test(normalized) ||
    normalized.includes("antilia") ||
    normalized.includes("passcode")
  ) {
    return "Passcode is too easy to guess.";
  }
  return null;
}
