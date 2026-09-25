/**
 * Application errors carry a stable machine-readable code, an HTTP status and
 * a human-readable message that is safe to show to users. Unexpected errors
 * are logged server-side and replaced with a generic message.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'TWO_FACTOR_REQUIRED'
  | 'EMAIL_NOT_VERIFIED'
  | 'FORBIDDEN'
  | 'ADMIN_REAUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'LIMIT_REACHED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'NOT_CONFIGURED'
  | 'INVALID_ADDRESS'
  | 'INTEGRATION_ERROR'
  | 'INTEGRATION_DISCONNECTED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'EXTERNAL_QUOTA_EXCEEDED'
  | 'PAYMENT_ERROR'
  | 'CSRF_FAILED'
  | 'INTERNAL_ERROR';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  TWO_FACTOR_REQUIRED: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  ADMIN_REAUTH_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  LIMIT_REACHED: 402,
  SUBSCRIPTION_INACTIVE: 402,
  NOT_CONFIGURED: 503,
  INVALID_ADDRESS: 422,
  INTEGRATION_ERROR: 502,
  INTEGRATION_DISCONNECTED: 409,
  EXTERNAL_SERVICE_ERROR: 502,
  EXTERNAL_QUOTA_EXCEEDED: 503,
  PAYMENT_ERROR: 402,
  CSRF_FAILED: 403,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, options: { status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.details = options.details;
    this.expose = true;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError('FORBIDDEN', message);
export const badRequest = (message: string, details?: unknown) => new AppError('BAD_REQUEST', message, { details });
export const conflict = (message: string, details?: unknown) => new AppError('CONFLICT', message, { details });
export const notConfigured = (feature: string, envVars: string[]) =>
  new AppError('NOT_CONFIGURED', `${feature} is not configured on this server.`, { details: { envVars } });

/** Error raised by an external provider call, classified for retry decisions. */
export class ExternalServiceError extends Error {
  readonly service: string;
  readonly httpStatus: number | null;
  readonly providerCode: string | null;
  readonly kind: 'transient' | 'auth' | 'quota' | 'permanent' | 'not_found';

  constructor(
    service: string,
    message: string,
    opts: { httpStatus?: number | null; providerCode?: string | null; kind: ExternalServiceError['kind']; cause?: unknown },
  ) {
    super(message, { cause: opts.cause });
    this.name = 'ExternalServiceError';
    this.service = service;
    this.httpStatus = opts.httpStatus ?? null;
    this.providerCode = opts.providerCode ?? null;
    this.kind = opts.kind;
  }
}

export const isExternalError = (e: unknown): e is ExternalServiceError => e instanceof ExternalServiceError;
