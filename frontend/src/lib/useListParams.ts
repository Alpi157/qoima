import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

import { parsePage } from './pagination'

/**
 * List state kept in the address (?q=&page=&...), so "Back" returns to the same list.
 * Typing a search or toggling a filter replaces the history entry and resets the page;
 * changing the page adds an entry.
 */
export function useListParams() {
  const [searchParams, setSearchParams] = useSearchParams()

  const setParam = useCallback(
    (name: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(name, value)
          else next.delete(name)
          next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setQ = useCallback((q: string) => setParam('q', q.trim() || null), [setParam])

  const setPage = useCallback(
    (page: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (page > 1) next.set('page', String(page))
        else next.delete('page')
        return next
      })
    },
    [setSearchParams],
  )

  return {
    q: searchParams.get('q') ?? '',
    page: parsePage(searchParams.get('page')),
    searchParams,
    setQ,
    setPage,
    setParam,
  }
}
