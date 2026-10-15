import { useRef, type MouseEvent, type ReactNode } from 'react'

interface ModalBackdropProps {
  onClose: () => void
  children: ReactNode
  className?: string
}

/**
 * Dimmed backdrop that closes on a genuine click on the backdrop itself — not on
 * a text selection that starts inside the modal (e.g. dragging to place the
 * cursor or select text in an input) and happens to release outside the modal
 * bounds. A plain `onClick={onClose}` on the backdrop fires in that case too,
 * since a browser "click" event targets wherever the mouse was released, not
 * where the drag started — closing the modal out from under the user mid-edit.
 * This only closes when both mousedown and the resulting click landed on the
 * backdrop itself.
 */
export function ModalBackdrop({ onClose, children, className }: ModalBackdropProps): JSX.Element {
  const mouseDownOnBackdrop = useRef(false)

  function handleMouseDown(e: MouseEvent<HTMLDivElement>): void {
    mouseDownOnBackdrop.current = e.target === e.currentTarget
  }

  function handleClick(e: MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget && mouseDownOnBackdrop.current) onClose()
  }

  return (
    <div
      className={className ?? 'fixed inset-0 z-50 flex items-center justify-center bg-black/50'}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {children}
    </div>
  )
}
