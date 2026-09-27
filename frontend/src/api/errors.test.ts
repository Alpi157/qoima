import { describe, expect, it } from 'vitest'

import {
  ApiError,
  apiErrorFromResponse,
  isClientError,
  networkError,
  SERVER_UNAVAILABLE,
} from './errors'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiErrorFromResponse', () => {
  it('reads detail and field errors from a validation error', async () => {
    const error = await apiErrorFromResponse(
      jsonResponse(422, {
        detail: 'Проверьте введённые данные',
        errors: [
          { field: 'lines.0.qty', message: 'Должно быть не меньше 1' },
          { field: 'note', message: 'Максимальная длина: 1000' },
          { field: 'note', message: 'Второе сообщение' },
        ],
      }),
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.detail).toBe('Проверьте введённые данные')
    expect(error.message).toBe('Проверьте введённые данные')
    expect(error.fieldErrors).toEqual({
      'lines.0.qty': 'Должно быть не меньше 1',
      note: 'Максимальная длина: 1000',
    })
  })

  it('reads detail from a business error without errors', async () => {
    const error = await apiErrorFromResponse(jsonResponse(409, { detail: 'Товар OC-90 в архиве' }))

    expect(error.status).toBe(409)
    expect(error.detail).toBe('Товар OC-90 в архиве')
    expect(error.fieldErrors).toEqual({})
  })

  it('reads 429 from login', async () => {
    const error = await apiErrorFromResponse(
      jsonResponse(429, { detail: 'Слишком много попыток входа. Попробуйте через минуту' }),
    )

    expect(error.status).toBe(429)
    expect(error.detail).toBe('Слишком много попыток входа. Попробуйте через минуту')
  })

  it('treats a non-JSON body as an unavailable server', async () => {
    const error = await apiErrorFromResponse(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    expect(error.status).toBe(502)
    expect(error.detail).toBe(SERVER_UNAVAILABLE)
    expect(error.fieldErrors).toEqual({})
  })

  it('treats an empty body as an unavailable server', async () => {
    const error = await apiErrorFromResponse(new Response(null, { status: 500 }))

    expect(error.detail).toBe(SERVER_UNAVAILABLE)
  })

  it('treats JSON without a string detail as an unavailable server', async () => {
    const error = await apiErrorFromResponse(jsonResponse(500, { message: 'boom' }))

    expect(error.detail).toBe(SERVER_UNAVAILABLE)
  })

  it('ignores malformed items in errors', async () => {
    const error = await apiErrorFromResponse(
      jsonResponse(422, {
        detail: 'x',
        errors: [null, { field: 1 }, { field: 'a', message: 'ok' }],
      }),
    )

    expect(error.fieldErrors).toEqual({ a: 'ok' })
  })
})

describe('networkError and isClientError', () => {
  it('network error has status 0 and is not a client error', () => {
    const error = networkError()
    expect(error.status).toBe(0)
    expect(error.detail).toBe(SERVER_UNAVAILABLE)
    expect(isClientError(error)).toBe(false)
  })

  it('classifies statuses', () => {
    expect(isClientError(new ApiError(404, 'x'))).toBe(true)
    expect(isClientError(new ApiError(500, 'x'))).toBe(false)
    expect(isClientError(new Error('x'))).toBe(false)
  })
})
