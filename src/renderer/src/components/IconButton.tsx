import type { ReactNode } from 'react'

interface IconButtonProps {
  onClick: () => void
  title: string
  tone?: 'default' | 'teal' | 'danger'
  children: ReactNode
}

const TONE_HOVER: Record<string, string> = {
  default: 'hover:text-vt-text',
  teal: 'hover:text-vt-teal',
  danger: 'hover:text-vt-danger'
}

export function IconButton({ onClick, title, tone = 'default', children }: IconButtonProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border-none bg-transparent text-vt-muted transition hover:bg-vt-surface2 ${TONE_HOVER[tone]}`}
    >
      {children}
    </button>
  )
}
