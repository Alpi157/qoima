import type { components } from './schema'

/** Machine-readable error code from the backend; decisions are made by it, never by the text. */
export type ErrorCode = components['schemas']['ErrorCode']

/**
 * `detail` of an error that did not come from our backend. Users never see it: the text is
 * built by `apiErrorText` (i18n/errorText.ts); this is for logs and debugging, like `detail`.
 */
export const SERVER_UNAVAILABLE = 'Сервер недоступен, попробуйте позже'

/** Data of an error message: `params` in the body of an error or of a field error. */
export type ErrorParams = Record<string, unknown>

/** One item of the validation `errors` list. */
export interface FieldError {
  /** Russian text from the backend, shown when there is no translation for `type`. */
  message: string
  /** Pydantic error type ("missing", "less_than_equal") or our own ("qty_zero"). */
  type: string
  params: ErrorParams
}

/** Error returned by the backend (see "Формат ошибок API" in docs/architecture.md). */
export class ApiError extends Error {
  readonly status: number
  /** Russian text from the backend; shown only when `code` has no translation. */
  readonly detail: string
  /** Field path (for example "lines.0.qty") -> error, from the validation `errors` list. */
  readonly fieldErrors: Record<string, FieldError>
  /** `code` from the response body; null when the backend was not reached or sent no code. */
  readonly code: string | null
  readonly params: ErrorParams

  constructor(
    status: number,
    detail: string,
    fieldErrors: Record<string, FieldError> = {},
    code: string | null = null,
    params: ErrorParams = {},
  ) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.fieldErrors = fieldErrors
    this.code = code
    this.params = params
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseParams(value: unknown): ErrorParams {
  return isRecord(value) && !Array.isArray(value) ? value : {}
}

function parseFieldErrors(value: unknown): Record<string, FieldError> {
  const result: Record<string, FieldError> = {}
  if (!Array.isArray(value)) return result
  for (const item of value) {
    if (!isRecord(item)) continue
    const { field, message, type } = item
    // Keep the first error for a field: it is the one the user should fix first.
    if (typeof field === 'string' && typeof message === 'string' && !(field in result)) {
      result[field] = {
        message,
        type: typeof type === 'string' ? type : '',
        params: parseParams(item.params),
      }
    }
  }
  return result
}

/** Builds an ApiError from a non-2xx response. A body that is not our JSON means no backend. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return new ApiError(response.status, SERVER_UNAVAILABLE)
  }
  if (!isRecord(body) || typeof body.detail !== 'string') {
    return new ApiError(response.status, SERVER_UNAVAILABLE)
  }
  const code = typeof body.code === 'string' ? body.code : null
  return new ApiError(
    response.status,
    body.detail,
    parseFieldErrors(body.errors),
    code,
    parseParams(body.params),
  )
}

/** The request never reached the backend (network down, DNS, CORS). */
export function networkError(): ApiError {
  return new ApiError(0, SERVER_UNAVAILABLE)
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** The error is an ApiError with this code. */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  return isApiError(error) && error.code === code
}

/** The backend was not reached or failed: the text is "server unavailable", not its detail. */
export function isServerOrNetworkError(error: unknown): boolean {
  return !isApiError(error) || error.status === 0 || error.status >= 500
}

export function isClientError(error: unknown): boolean {
  return isApiError(error) && error.status >= 400 && error.status < 500
}
