export const SERVER_UNAVAILABLE = 'Сервер недоступен, попробуйте позже'

/** Error returned by the backend (see "Формат ошибок API" in docs/architecture.md). */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string
  /** Field path (for example "lines.0.qty") -> message, from the validation `errors` list. */
  readonly fieldErrors: Record<string, string>

  constructor(status: number, detail: string, fieldErrors: Record<string, string> = {}) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.fieldErrors = fieldErrors
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
  return new ApiError(response.status, body.detail, parseFieldErrors(body.errors))
}

/** The request never reached the backend (network down, DNS, CORS). */
export function networkError(): ApiError {
  return new ApiError(0, SERVER_UNAVAILABLE)
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function isClientError(error: unknown): boolean {
  return isApiError(error) && error.status >= 400 && error.status < 500
}
