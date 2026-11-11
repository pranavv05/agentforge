# FAQ

## What is simulated?

This deployment is a working implementation of the governance layer. These parts are real: the state machine, hash-bound approvals, the append-only audit log, the grounding verifier, the compliance lint, cost accounting and authentication.

These parts are simulated: model output (generated deterministically from your description), token counts (estimates priced with a real table) and the repository (a bundled sample, not your own). Simulated cost rows are labelled as such.

## Can I connect my own repository?

Not yet. Existing-codebase runs use the bundled `acme-erp` sample so that claims can be verified without access to your code.

## Which compliance rules are covered?

GST e-invoice fields, applicability threshold and IRN immutability, plus TDS under Section 393. See [Grounding and compliance](/docs/grounding-compliance). Rates are illustrative and must be verified before real use.

## Do I need an API key?

Yes. AgentForge is open source and bring-your-own-key: connect your own Claude API key and you are ready to go. See [Bring your own key](/docs/byok).

In this preview build model output is simulated, so no key is needed and nothing is billed.

## Who can approve?

Only a signed-in human who owns the spec. Agents cannot approve and cannot change status.

## How are passwords stored?

Passwords are hashed with PBKDF2 (SHA-256, 100,000 iterations, random salt). Sessions are random tokens stored hashed, delivered in an `HttpOnly` cookie.

## Is there a password reset?

Not yet. Use the playgrounds under Product to explore without an account.
