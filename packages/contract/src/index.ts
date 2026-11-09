/**
 * `@agentforge/contract` — the frozen boundary.
 *
 * Everything that crosses a process boundary is defined here: states, artifact
 * payloads, entity shapes, the error taxonomy and the HTTP contract. The backend and
 * the UI both import from this package and nowhere else, which is what allows the two
 * tracks to be built in parallel.
 *
 * Nothing in here may import from another `@agentforge/*` package: the contract sits
 * at the bottom of the dependency graph by design.
 */

export * from './states.ts';
export * from './ids.ts';
export * from './evidence.ts';
export * from './artifacts.ts';
export * from './compliance.ts';
export * from './entities.ts';
export * from './errors.ts';
export * from './api.ts';
export * from './client.ts';
