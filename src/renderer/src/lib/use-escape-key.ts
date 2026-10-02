import { useEffect } from 'react'

/**
 * Call `onEscape` when Escape is pressed. Use `capture` for overlays that must
 * win over parent modals (e.g. confirm dialogs).
 */
export function useEscapeKey(onEscape: () => void, enabled = true, capture = false): void {
  useEffect(() => {
    if (!enabled) return
    function handle(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (capture) e.stopImmediatePropagation()
      onEscape()
    }
    window.addEventListener('keydown', handle, capture)
    return () => window.removeEventListener('keydown', handle, capture)
  }, [onEscape, enabled, capture])
}
