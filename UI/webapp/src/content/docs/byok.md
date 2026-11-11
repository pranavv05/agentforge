# Bring your own key

AgentForge is open source. To run it, bring your own Claude API key. That is the only setup.

## Set up

1. Create an API key in your Claude console. A key made just for AgentForge is best, so you can revoke it on its own.
2. Add the key in your workspace settings. It is stored encrypted and is never shown in full again.
3. Start building specs.

Claude is the only supported provider for now. Keys start with `sk-ant-`.

## Keeping the key safe

- Never paste a key into a spec, a comment or a commit.
- If you think a key was exposed, revoke it in your Claude console and add a new one.
- Your provider's data terms apply to what is sent to the model.
