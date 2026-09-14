import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

export function KeyIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M15.5 7.5a4.5 4.5 0 1 1-4.5-4.5" />
      <path d="m14.5 9.5 5 5-2 2" />
      <path d="m17.5 12.5 2 2" />
      <path d="M8 8l-6.5 6.5 3 3 2-2" />
      <path d="M2.5 12.5l2 2" />
    </Svg>
  )
}

export function LockIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="9" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  )
}

export function ShieldIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z" />
    </Svg>
  )
}

export function AlertTriangleIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  )
}

export function ChevronLeftIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  )
}

export function ChevronRightIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9 18l6-6-6-6" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  )
}

export function FolderIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Svg>
  )
}

export function EyeIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function CopyIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="10" height="10" rx="1" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Svg>
  )
}

export function PencilIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="M15 5l4 4" />
    </Svg>
  )
}

export function TrashIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Svg>
  )
}

export function LifeBuoyIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="m4.93 4.93 4.24 4.24" />
      <path d="m14.83 14.83 4.24 4.24" />
      <path d="m14.83 9.17 4.24-4.24" />
      <path d="m4.93 19.07 4.24-4.24" />
    </Svg>
  )
}

export function UserIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20 21a8 8 0 1 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  )
}

export function StarIcon({ filled, ...props }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill={filled ? '#facc15' : 'none'}
      stroke={filled ? '#facc15' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      style={{ flexShrink: 0 }}
    >
      <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 4.111a.563.563 0 0 0 .475.31l4.54.66a.563.563 0 0 1 .31.96l-3.286 3.203a.563.563 0 0 0-.163.5l.776 4.52a.562.562 0 0 1-.815.594l-4.052-2.126a.563.563 0 0 0-.524 0l-4.052 2.126a.562.562 0 0 1-.815-.594l.776-4.52a.563.563 0 0 0-.163-.5L2.291 9.54a.563.563 0 0 1 .31-.96l4.54-.66a.563.563 0 0 0 .475-.31z" />
    </svg>
  )
}
