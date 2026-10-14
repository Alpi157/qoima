import { useEffect, useState } from 'react'

import { PAGE_SIZE } from '../../lib/pagination'

/** Find a concrete document without changing the visible page while searching. */
export function usePagedFocus<T>(
  target: string | null,
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
  keyOf: (item: T) => string,
  onFound: (page: number) => void,
) {
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!target) return
    let stopped = false
    const find = async () => {
      for (let page = 1; !stopped; page++) {
        const result = await fetchPage(page)
        if (stopped) return
        if (result.items.some((item) => keyOf(item) === target)) {
          setError(null)
          setHighlighted(target)
          onFound(page)
          return
        }
        if (page * PAGE_SIZE >= result.total) throw new Error('Document is no longer in the list')
      }
    }
    void find().catch((failure: unknown) => {
      if (!stopped) setError(failure)
    })
    return () => {
      stopped = true
    }
  }, [target, fetchPage, keyOf, onFound, attempt])
  useEffect(() => {
    if (!highlighted) return
    const interval = window.setInterval(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-row-key]')].find(
        (element) => element.dataset.rowKey === highlighted && element.getClientRects().length > 0,
      )
      if (row) {
        row.scrollIntoView({ block: 'center' })
        row.focus({ preventScroll: true })
        window.clearInterval(interval)
      }
    }, 50)
    const timer = window.setTimeout(() => {
      window.clearInterval(interval)
      setHighlighted(null)
    }, 4000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timer)
    }
  }, [highlighted])
  return {
    highlighted,
    error,
    retry: () => {
      setError(null)
      setAttempt((value) => value + 1)
    },
  }
}
