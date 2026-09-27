export const PAGE_SIZE = 50

/** Offset for a 1-based page number. */
export function pageOffset(page: number): number {
  return (page - 1) * PAGE_SIZE
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}

/** "3" -> 3; missing, zero, negative or garbage -> 1. */
export function parsePage(value: string | null): number {
  const page = Number(value)
  return Number.isSafeInteger(page) && page >= 1 ? page : 1
}
