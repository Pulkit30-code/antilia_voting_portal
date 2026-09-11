export class AuthenticationError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_CREDENTIALS",
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class PasscodeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasscodeValidationError";
  }
}
