interface BrandLogoProps {
  size?: number
  withWordmark?: boolean
}

export function BrandLogo({ size = 28, withWordmark = false }: BrandLogoProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="16" fill="#0F172A" />
        <rect width="64" height="64" rx="16" fill="url(#vaultic-grad)" fillOpacity="0.35" />
        <path
          d="M32 12L50 19V30C50 40.5 42.8 47.8 32 52C21.2 47.8 14 40.5 14 30V19L32 12Z"
          stroke="#2DD4BF"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="28" r="6" stroke="#2DD4BF" strokeWidth="2.5" />
        <path d="M32 34V40" stroke="#2DD4BF" strokeWidth="2.5" strokeLinecap="round" />
        <defs>
          <linearGradient id="vaultic-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2DD4BF" />
            <stop offset="1" stopColor="#0F172A" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      {withWordmark && (
        <span className="text-lg font-semibold tracking-tight text-vt-text">
          Vaultic
        </span>
      )}
    </div>
  )
}
