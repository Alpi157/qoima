import { createContext, useContext, useEffect } from 'react'

export const StatusContext = createContext<{
  setStatus: (status: { unknown: boolean; busy: boolean }) => void
  clear: () => void
  openSaved: () => void
  close: () => void
} | null>(null)

export function useDocumentModalStatus(unknown: boolean, busy: boolean) {
  const context = useContext(StatusContext)
  const setStatus = context?.setStatus
  useEffect(() => {
    setStatus?.({ unknown, busy })
  }, [unknown, busy, setStatus])
  return context
}
