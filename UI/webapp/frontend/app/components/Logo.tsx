import { useId } from 'react'

export const BRAND = 'AgentForge'
export const TAGLINE = 'Evidence-checked spec-driven development'

/** Rounded tile with an "A" drawn as one agent stroke, a green verified check and a pulsing agent node. */
export function LogoMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="lg" viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={`${BRAND} logo`}>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2f6fe4" /><stop offset="1" stopColor="#8b7bff" /></linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <g className="lg-tile">
        <rect x="1" y="1" width="38" height="38" rx="11.5" fill={`url(#${id}b)`} />
        <rect x="1" y="1" width="38" height="19" rx="11.5" fill={`url(#${id}s)`} />
      </g>
      <path className="lg-a" pathLength={100} d="M11.5 29.5 20 10.5l8.5 19" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path className="lg-ck" pathLength={100} d="M15.6 24.6l3.4 3.2 5.6-6.4" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="lg-ring" cx="20" cy="10.5" r="3" fill="none" stroke="#fff" strokeWidth="1.2" />
      <circle className="lg-dot" cx="20" cy="10.5" r="3" fill="#fff" />
      <circle cx="20" cy="10.5" r="1.3" fill="#2f6fe4" />
    </svg>
  )
}

export function Logo() {
  return (
    <a href="/" className="logo" aria-label={`${BRAND} home`}>
      <LogoMark size={32} />
      <span className="logo-t">Agent<b>Forge</b></span>
    </a>
  )
}
