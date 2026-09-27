import type { components } from './schema'

/** Machine-readable error code from the backend; decisions are made by it, never by the text. */
export type ErrorCode = components['schemas']['ErrorCode']

export const SERVER_UNAVAILABLE = 'Сервер недоступен, попробуйте позже'

/** Error returned by the backend (see "Формат ошибок API" in docs/architecture.md). */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string
  /** Field path (for example "lines.0.qty") -> message, from the validation `errors` list. */
  readonly fieldErrors: Record<string, string>
  /** `code` from the response body; null when the backend was not reached or sent no code. */
  readonly code: string | null

  constructor(
    status: number,
    detail: string,
    fieldErrors: Record<string, string> = {},
    code: string | null = null,
  ) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.fieldErrors = fieldErrors
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseFieldErrors(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!Array.isArray(value)) return result
  for (const item of value) {
    if (!isRecord(item)) continue
    const { field, message } = item
    // Keep the first message for a field: it is the one the user should fix first.
    if (typeof field === 'string' && typeof message === 'string' && !(field in result)) {
      result[field] = message
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
  return new ApiError(response.status, body.detail, parseFieldErrors(body.errors), code)
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

export function isClientError(error: unknown): boolean {
  return isApiError(error) && error.status >= 400 && error.status < 500
}
