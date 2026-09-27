export const DEFAULT_PATH = '/sale'
export const LOGIN_PATH = '/login'

/** Where to go after login. Only same-site paths are allowed, to avoid an open redirect. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_PATH
  }
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return DEFAULT_PATH
  return value
}

/** "/login?next=%2Fproducts" for the current location. */
export function loginPathFor(pathname: string, search = ''): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(pathname + search)}`
}
