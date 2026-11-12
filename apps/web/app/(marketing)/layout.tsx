import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@/components/site/style.css';
import '@/components/site/site.css';

/**
 * The marketing shell.
 *
 * Deliberately almost empty: the landing page brings its own `Nav` and `Footer`, so a
 * header here would be a second one. What this layout does own is the document-level
 * setup those components assume — the typefaces, the icon set, and a class set before
 * first paint so scroll-reveal content is hidden from the start rather than appearing
 * and then jumping.
 *
 * It also brings the marketing stylesheets, which is the reason `globals.css` moved out
 * of the root layout and into `(workspace)`. Both define `:root`, `html`, `body` and
 * `a`, and whichever loaded second won — so the two were fighting over every page in
 * the app. They are now scoped to the route groups that want them, which is what the
 * root layout always claimed was the arrangement.
 */

export const metadata: Metadata = {
  // Absolute: this is the whole title. The root layout's template would otherwise
  // append the brand to a string that already ends with it.
  title: { absolute: 'AgentForge — evidence-checked spec-driven development' },
  description:
    'An agentic spec-driven development platform with server-enforced approvals, ' +
    'verifiable codebase grounding and compliance traceability.',
  icons: { icon: '/static/logo.svg' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Sets `js` and `sj` before first paint.
 *
 * Without it the scroll-reveal styles cannot apply until hydration, so the page renders
 * fully visible and then hides itself — a flash on every load. `sj` is withheld when the
 * visitor asks for reduced motion, so for them the content is simply visible and no
 * reveal ever runs.
 */
const BOOT =
  "document.documentElement.classList.add('js');" +
  "if(!matchMedia('(prefers-reduced-motion: reduce)').matches)" +
  "document.documentElement.classList.add('sj')";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <link
        href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
        rel="stylesheet"
      />
      {/* Inline and tiny because it must run before the first paint, not after a
          round trip. It sets two class names and reads one media query. */}
      <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      <noscript>
        <style>{`.sj [data-split] .si,.sj .stg>*,.rv{opacity:1!important;transform:none!important}`}</style>
      </noscript>

      {children}
    </>
  );
}
