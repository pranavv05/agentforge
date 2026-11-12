import { Logo, BRAND, TAGLINE } from './Logo';

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
          <div>
            <h2 className="gh">Product</h2>
            <a href="/product/pipeline">Governed pipeline</a>
            <a href="/product/grounding">Grounding verifier</a>
            <a href="/product/compliance">Compliance pack</a>
          </div>
          <div>
            <h2 className="gh">Resources</h2>
            <a href="/docs">Documentation</a>
            <a href="/resources/edit-hook">Edit-hook tester</a>
            <a href="/resources/errors">Error decoder</a>
            <a href="/resources/templates">Spec templates</a>
          </div>
          <div>
            <h2 className="gh">Compare</h2>
            <a href="/compare">Overview</a>
            <a href="/compare/spec-kit">Spec Kit</a>
            <a href="/compare/kiro">Kiro</a>
            <a href="/compare/spec-workflow-mcp">Spec Workflow MCP</a>
          </div>
          <div>
            <h2 className="gh">Account</h2>
            <a href="/sign-in">Sign in</a>
            <a href="/docs/changelog">Changelog</a>
          </div>
        </div>
        <div className="fbot">
          <span>&copy; 2026 {BRAND}.</span>
          <span>Open source. Agents propose; humans approve.</span>
        </div>
      </div>
    </footer>
  );
}
