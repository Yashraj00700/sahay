export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTEGRATION_ERROR'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details?: unknown
  readonly expose: boolean

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    opts: { details?: unknown; cause?: unknown; expose?: boolean } = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = opts.details
    this.expose = opts.expose ?? statusCode < 500
    if (opts.cause) (this as { cause?: unknown }).cause = opts.cause
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, { details })
    this.name = 'ValidationError'
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401)
    this.name = 'AuthError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', message, 404)
    this.name = 'NotFoundError'
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSec: number) {
    super('RATE_LIMITED', 'Too many requests', 429, { details: { retryAfterSec } })
    this.name = 'RateLimitError'
  }
}

export class IntegrationError extends AppError {
  constructor(integration: string, message: string, cause?: unknown) {
    super('INTEGRATION_ERROR', `${integration}: ${message}`, 502, { cause })
    this.name = 'IntegrationError'
  }
}
