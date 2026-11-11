import { Logo, BRAND, TAGLINE } from './Logo'

export function Footer() {
  return (
    <footer className="f">
      <div className="wrap">
        <div className="fgrid">
          <div>
            <Logo />
            <p style={{ color: 'var(--mute)', fontSize: 14, maxWidth: 260, margin: '14px 0 0' }}>
              {TAGLINE}. Agents propose, the orchestrator transitions, humans approve.
            </p>
          </div>
          <div><h6>Product</h6><a href="/product/pipeline">Governed pipeline</a><a href="/product/grounding">Grounding verifier</a><a href="/product/compliance">Compliance pack</a><a href="/product/byok">Bring your own key</a></div>
          <div><h6>Resources</h6><a href="/docs">Documentation</a><a href="/resources/edit-hook">Edit-hook tester</a><a href="/resources/errors">Error decoder</a><a href="/resources/templates">Spec templates</a></div>
          <div><h6>Compare</h6><a href="/compare">Overview</a><a href="/compare/spec-kit">Spec Kit</a><a href="/compare/kiro">Kiro</a><a href="/compare/spec-workflow-mcp">Spec Workflow MCP</a></div>
          <div><h6>Account</h6><a href="/login">Sign in</a><a href="/product/byok">Bring your own key</a><a href="/docs/changelog">Changelog</a></div>
        </div>
        <div className="fbot"><span>&copy; 2026 {BRAND}.</span><span>Demo build: model output is simulated.</span></div>
      </div>
    </footer>
  )
}
