/** Typed domain errors. Route handlers and actions map these to safe user-facing messages. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You are not authorized to perform this action") {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "Record") {
    // Deliberately identical for "does not exist" and "belongs to another tenant".
    super(`${what} not found`, "not_found", 404);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details: string[] = []) {
    super(message, "validation", 422, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details: string[] = []) {
    super(message, "conflict", 409, details);
  }
}

export class TransitionError extends DomainError {
  constructor(message: string, problems: string[]) {
    super(message, "transition_rejected", 409, problems);
  }
}

export function toUserMessage(err: unknown): { message: string; details: string[] } {
  if (err instanceof DomainError) return { message: err.message, details: err.details };
  return { message: "Something went wrong. The action was not completed.", details: [] };
}
