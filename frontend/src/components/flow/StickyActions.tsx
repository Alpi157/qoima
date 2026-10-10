import { Group } from '@mantine/core'
import { type ReactNode, useLayoutEffect, useRef } from 'react'

/** Shared by sale review and totals panels: focused fields stay above the action panel. */
export function StickyActions({
  children,
  className = 'flow-review-actions',
}: {
  children: ReactNode
  className?: string
}) {
  const actions = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const panel = actions.current
    if (!panel) return
    const root = document.documentElement
    const previous = root.style.scrollPaddingBottom
    const reserve = () => {
      const surface = panel.closest('.flow-aside') ?? panel
      root.style.scrollPaddingBottom = `${Math.ceil(surface.getBoundingClientRect().height)}px`
    }
    reserve()
    const observer = new ResizeObserver(reserve)
    observer.observe(panel)
    return () => {
      observer.disconnect()
      root.style.scrollPaddingBottom = previous
    }
  }, [])
  return (
    <Group ref={actions} justify="space-between" gap="md" className={className}>
      {children}
    </Group>
  )
}
