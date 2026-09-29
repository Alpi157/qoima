import { useCallback, useEffect, useState } from 'react'

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
  /** An empty document; for a sale it takes a new request_id. */
  create: () => T
  /** The saved value if it still has the expected shape, else null (it is then dropped). */
  parse: (raw: unknown) => T | null
  /** Nothing worth keeping: no lines. */
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
    return saved !== null && !isEmpty(saved)
      ? { value: saved, restored: true }
      : { value: create(), restored: false }
  })

  useEffect(() => {
    writeDraft(key, isEmpty(state.value) ? null : state.value)
  }, [key, state.value, isEmpty])

  const update = useCallback(
    (change: (value: T) => T) =>
      setState((current) => ({ ...current, value: change(current.value) })),
    [],
  )

  /** After a save or «Бас тарту»: a fresh document, the draft is removed. */
  const clear = useCallback(() => {
    writeDraft(key, null)
    setState({ value: create(), restored: false })
  }, [key, create])

  const dismissRestored = useCallback(
    () => setState((current) => ({ ...current, restored: false })),
    [],
  )

  return { value: state.value, update, clear, restored: state.restored, dismissRestored }
}
