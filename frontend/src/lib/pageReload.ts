import { reloadPage } from './browserReload.js'

export const PAGE_RELOAD_KEY = 'qoima:page-reload-at'
const RETRY_WINDOW_MS = 30_000
let reloadRequested = false

/** Vite and the lazy loader can report the same failure in one document. */
export function tryPageReload(event?: Event): boolean {
  if (reloadRequested) return false
  try {
    const now = Date.now()
    const stored = window.sessionStorage.getItem(PAGE_RELOAD_KEY)
    const previous = stored === null ? NaN : Number(stored)
    if (Number.isFinite(previous) && now - previous < RETRY_WINDOW_MS) return false
    window.sessionStorage.setItem(PAGE_RELOAD_KEY, String(now))
  } catch {
    // Without a durable guard a reload could loop forever.
    return false
  }
  reloadRequested = true
  event?.preventDefault()
  reloadPage()
  return true
}

export function clearPageReload(): void {
  try {
    window.sessionStorage.removeItem(PAGE_RELOAD_KEY)
  } catch {
    // An unavailable storage must not turn a loaded page into an error.
  }
}

export function handlePreloadError(event: Event): void {
  tryPageReload(event)
}

export class PageModuleError extends Error {
  constructor(cause: unknown) {
    super('Page module could not be loaded', { cause })
    this.name = 'PageModuleError'
  }
}
