/** Text of the error shown under a field (Mantine links it via aria-describedby), or null. */
export function fieldErrorOf(input: HTMLElement): string | null {
  if (input.getAttribute('aria-invalid') !== 'true') return null
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? []
  const errorId = ids.find((id) => id.endsWith('-error'))
  return errorId ? (document.getElementById(errorId)?.textContent ?? null) : null
}
