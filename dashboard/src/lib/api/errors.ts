export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  /** Structured extras, e.g. {path, byName, byLogin} on a 409 conflict. */
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, hint?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isConflict(error: unknown) {
  return isApiError(error) && error.status === 409;
}

export function isForbidden(error: unknown) {
  return isApiError(error) && error.status === 403;
}

/** What happened and what to do next, for toasts. Uses the API's message and hint when present. */
export function errorText(error: unknown): string {
  if (isApiError(error)) return [error.message, error.hint].filter(Boolean).join(" ");
  return "SelfHub didn't respond. Check your connection, then try again.";
}
