'use client';

/**
 * Example requests that fill the composer when chosen.
 *
 * These were plain list items that looked like suggestions and did nothing when clicked,
 * which is worse than not offering them: it teaches a new user that the interface is
 * decorative on the very first screen they see.
 *
 * They talk to the composer through a window event rather than shared state, because the
 * two sit in different parts of a server-rendered page and lifting state between them
 * would turn the whole empty screen into one client component for the sake of a click.
 */

export const PREFILL_EVENT = 'agentforge:prefill';

export function ExamplePrompts({ examples }: { examples: readonly string[] }) {
  return (
    <ul className="empty__examples" aria-label="Example requests">
      {examples.map((example) => (
        <li key={example}>
          <button
            className="empty__example"
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent<string>(PREFILL_EVENT, { detail: example }));
            }}
          >
            {example}
          </button>
        </li>
      ))}
    </ul>
  );
}
