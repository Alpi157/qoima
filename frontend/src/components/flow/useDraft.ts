import { useCallback, useEffect, useRef, useState } from 'react'

/** A flow whose unfinished document is kept: the sale and the receiving. */
export type DraftFlow = 'sale' | 'receipt'

/** localStorage key of one user's draft of one flow. */
export function draftKey(userId: number, flow: DraftFlow): string {
  return `qoima.draft.${userId}.${flow}`
}

function readDraft(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key)
    return text === null ? null : (JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

function writeDraft(key: string, value: unknown | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the document is still on the screen, only the draft is lost.
  }
}

export interface DraftOptions<T> {
  userId: number
  flow: DraftFlow
  /** A fresh document with a new request_id. */
  create: () => T
  /** The saved value if it still has the expected shape, else null (it is then dropped). */
  parse: (raw: unknown) => T | null
  /** Whether there are no document lines, for the restored notice. */
  isEmpty: (value: T) => boolean
}

/**
 * The document being filled in, kept in localStorage per user and flow (simple-ui.md,
 * «Черновики»): leaving the screen or reloading the page does not lose it.
 * `restored` is true when the screen opened with a saved draft, for the notice.
 */
export function useDraft<T>({ userId, flow, create, parse, isEmpty }: DraftOptions<T>) {
  const key = draftKey(userId, flow)
  const [state, setState] = useState(() => {
    const saved = parse(readDraft(key))
    return saved !== null
      ? { value: saved, restored: !isEmpty(saved), retained: true }
      : { value: create(), restored: false, retained: false }
  })
  const current = useRef(state)

  useEffect(() => {
    if (current.current.retained) writeDraft(key, current.current.value)
  }, [key])

  const update = useCallback(
    (change: (value: T) => T, dismiss = true) => {
      const next = {
        value: change(current.current.value),
        restored: dismiss ? false : current.current.restored,
        retained: true,
      }
      current.current = next
      // Persist before starting a POST: a reload during the request must keep its key.
      writeDraft(key, next.value)
      setState(next)
    },
    [key],
  )

  /** After a save or «Бас тарту»: a fresh document, the draft is removed. */
  const clear = useCallback(() => {
    writeDraft(key, null)
    const next = { value: create(), restored: false, retained: false }
    current.current = next
    setState(next)
  }, [key, create])

  const dismissRestored = useCallback(() => {
    const next = { ...current.current, restored: false }
    current.current = next
    setState(next)
  }, [])

  return { value: state.value, update, clear, restored: state.restored, dismissRestored }
}
