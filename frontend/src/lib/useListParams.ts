import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

import { parsePage } from './pagination'

/**
 * List state kept in the address (?q=&page=&...), so "Back" returns to the same list.
 * Typing a search or toggling a filter replaces the history entry and resets the page;
 * changing the page adds an entry.
 */
export function useListParams(pageParam = 'page') {
  const [searchParams, setSearchParams] = useSearchParams()

  /** Sets several filters at once (for example both ends of a date range); null removes one. */
  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [name, value] of Object.entries(updates)) {
            if (value) next.set(name, value)
            else next.delete(name)
          }
          next.delete(pageParam)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams, pageParam],
  )

  const setParam = useCallback(
    (name: string, value: string | null) => setParams({ [name]: value }),
    [setParams],
  )

  const setQ = useCallback((q: string) => setParam('q', q.trim() || null), [setParam])

  const setPage = useCallback(
    (page: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (page > 1) next.set(pageParam, String(page))
        else next.delete(pageParam)
        return next
      })
    },
    [setSearchParams, pageParam],
  )

  return {
    q: searchParams.get('q') ?? '',
    page: parsePage(searchParams.get(pageParam)),
    searchParams,
    setQ,
    setPage,
    setParam,
    setParams,
  }
}
