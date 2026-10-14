import createClient, { type Middleware } from 'openapi-fetch'

import { apiErrorFromResponse, networkError } from './errors'
import type { paths } from './schema'

const LOGIN_PATH = '/api/auth/login'

let onUnauthorized: () => void = () => {}

/** Called on 401 from any request except login (an expired or missing session). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

// Every non-2xx response becomes a thrown ApiError, so callers only see successful data.
const errorMiddleware: Middleware = {
  async onResponse({ response, schemaPath }) {
    if (response.ok) return undefined
    if (response.status === 401 && schemaPath !== LOGIN_PATH) {
      onUnauthorized()
    }
    throw await apiErrorFromResponse(response.clone())
  },
  onError() {
    return networkError()
  },
}

export const api = createClient<paths>()
api.use(errorMiddleware)

/** Returns the response data; errors are already thrown by the middleware. */
export async function unwrap<T>(request: Promise<{ data?: T }>): Promise<T> {
  const { data } = await request
  return data as T
}

/** A fresh deadline for each attempt; aborting never proves that a POST was not saved. */
export async function withDocumentTimeout<T>(
  send: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30_000)
  try {
    return await send(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw networkError()
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
