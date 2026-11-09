import type { NextConfig } from 'next';

/**
 * Next.js configuration.
 *
 * The workspace packages are published as TypeScript source (no build step), so Next
 * transpiles them directly. `better-sqlite3` is a native module and must stay external
 * to the server bundle.
 */
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@agentforge/contract',
    '@agentforge/db',
    '@agentforge/orchestrator',
    '@agentforge/agents',
    '@agentforge/llm',
    '@agentforge/compliance',
    '@agentforge/context-agent',
  ],
  serverExternalPackages: ['better-sqlite3', 'pino'],
  // Linting is a separate CI step over the whole monorepo with one shared config.
  typedRoutes: false,
};

export default config;
