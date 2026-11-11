import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentforge/contract': pkg('contract'),
      '@agentforge/db': pkg('db'),
      '@agentforge/orchestrator': pkg('orchestrator'),
      '@agentforge/llm': pkg('llm'),
      '@agentforge/skills': pkg('skills'),
      '@agentforge/agents': pkg('agents'),
      '@agentforge/context-agent': pkg('context-agent'),
      '@agentforge/compliance': pkg('compliance'),
      '@agentforge/eval': pkg('eval'),
      // The web app's own path aliases, so route handlers can be imported in tests.
      // Spelled out per directory rather than as a bare '@' so they cannot shadow the
      // '@agentforge/*' entries above.
      '@/app': fileURLToPath(new URL('./apps/web/app', import.meta.url)),
      '@/lib': fileURLToPath(new URL('./apps/web/lib', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    // Each suite gets its own temp SQLite file; forks keep native module state clean.
    pool: 'forks',
    // The default 5s is too tight for the suites that spawn real subprocesses — the
    // PreToolUse hook and the MCP server are both driven as separate processes on
    // purpose, since a hook tested in-process would not prove the hook works. Under a
    // loaded runner those spawns intermittently crossed 5s, which is a flake rather
    // than a finding. The hook's own latency is asserted separately, so raising this
    // does not loosen the requirement that it answers fast.
    testTimeout: 30_000,
    // Some suites legitimately do heavy one-off setup — parsing a repository with
    // tree-sitter, applying migrations — which the 10s default does not cover.
    hookTimeout: 60_000,
    // Assertions are the signal in tests, not the log stream.
    // LOG_LEVEL keeps the assertions as the signal; SDD_NO_ENV_FILE keeps the suite
    // offline and free even on a machine with a working .env.
    env: { LOG_LEVEL: 'silent', SDD_NO_ENV_FILE: '1' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/index.ts',
        'packages/skills/src/**',
        '**/*.d.ts',
        // CLI entry points: exercised by `npm run db:migrate` / `db:reset`, not by
        // unit tests. Their logic lives in client.ts, which is covered.
        'packages/db/src/migrate.ts',
        'packages/db/src/reset.ts',
        // Table declarations, not logic. Validated against the live database by
        // packages/db/test/drift.test.ts.
        'packages/db/src/schema.ts',
      ],
      // Quality bar: >=90% on the governance- and grounding-critical packages,
      // >=75% overall. Enforced here, not eyeballed.
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 70,
        'packages/orchestrator/src/**': {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 85,
        },
        'packages/context-agent/src/verifier.ts': {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 85,
        },
        'packages/compliance/src/**': {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 85,
        },
      },
    },
  },
});
