import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './styles/style.css'
import './styles/site.css'
import './styles/landing.css'

export const metadata: Metadata = {
  title: 'AgentForge — Evidence-checked spec-driven development',
  description:
    'An agentic spec-driven development platform with server-enforced approvals, verifiable codebase grounding and compliance traceability.',
  icons: { icon: '/static/logo.svg' },
}
export const viewport: Viewport = { themeColor: '#ffffff', width: 'device-width', initialScale: 1 }

/** Adds `js` + `sj` (scroll-motion) classes before first paint so there is no flash of un-hidden text. */
const bootScript = `document.documentElement.classList.add('js');if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('sj')`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
        <noscript>
          <style>{`.sj [data-split] .si,.sj .stg>*,.rv{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  )
}
