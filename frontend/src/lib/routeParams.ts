/** Id from the address ("/products/:id"): a positive integer, otherwise null. */
export function parseId(value: string | undefined): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
