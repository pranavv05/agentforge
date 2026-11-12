'use client';

import { useEffect, useRef, useState } from 'react';
import { PREFILL_EVENT } from '@/components/workspace/example-prompts';
import { ErrorNote } from '@/components/workspace/error-note';
import { explainError, type ErrorExplanation } from '@/components/workspace/explain-error';
import { useRouter } from 'next/navigation';
import { createClient, type SpecMode } from '@agentforge/contract';

/**
 * The composer.
 *
 * The entry point for the whole product: prose in, structured spec out. A form with
 * Title and Description fields was the wrong shape — the thing being asked for is a
 * sentence, and the pipeline's job is to structure it.
 *
 * Mode still has to be chosen, because brownfield genuinely changes what happens: it
 * scans a repository first and subjects every later claim about existing code to
 * verification. It sits *inside* the composer as a quiet control rather than above it as
 * a section, the way a model picker does.
 *
 * The title is derived from the first line rather than asked for. One field is the point.
 */

const client = createClient();

/** A short title from the request text: first sentence or first line, whichever is shorter. */
function deriveTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0] ?? '';
  const firstSentence = /^(.{10,120}?)[.!?](\s|$)/.exec(firstLine)?.[1];
  const candidate = (firstSentence ?? firstLine).trim();

  if (candidate.length <= 120) return candidate;
  // Cut on a word boundary rather than mid-word.
  return `${candidate.slice(0, 117).replace(/\s+\S*$/, '')}…`;
}

export function Composer({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [text, setText] = useState('');
  const [mode, setMode] = useState<SpecMode>('greenfield');
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState<ErrorExplanation | null>(null);
  const [pending, setPending] = useState(false);

  // An example prompt was chosen: put it in the box and put the cursor at the end, so the
  // user can edit it rather than having to select and retype.
  useEffect(() => {
    const onPrefill = (event: Event): void => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      setText(event.detail);
      const box = textareaRef.current;
      if (box === null) return;
      box.focus();
      window.setTimeout(() => {
        box.setSelectionRange(box.value.length, box.value.length);
      }, 0);
    };

    window.addEventListener(PREFILL_EVENT, onPrefill);
    return () => {
      window.removeEventListener(PREFILL_EVENT, onPrefill);
    };
  }, []);

  const ready = text.trim().length >= 20 && (mode === 'greenfield' || repoPath.trim().length > 0);

  async function submit(): Promise<void> {
    if (!ready || pending) return;

    setError(null);
    setPending(true);

    try {
      const result = await client.createSpec({
        title: deriveTitle(text),
        description: text.trim(),
        mode,
        repo_path: mode === 'brownfield' ? repoPath.trim() : null,
      });

      router.refresh();
      router.push(`/workspace/${result.spec.id}`);
    } catch (caught) {
      setError(explainError(caught, 'The spec could not be created. Nothing was saved.'));
      setPending(false);
    }
  }

  return (
    <form
      className="composer"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="visually-hidden" htmlFor="composer-input">
        Describe the feature you want to build
      </label>

      <textarea
        className="composer__input"
        id="composer-input"
        ref={textareaRef}
        rows={3}
        value={text}
        autoFocus={autoFocus}
        maxLength={5000}
        placeholder="Describe the feature you want to build…"
        onChange={(event) => {
          setText(event.target.value);
          // Grow with the content up to a ceiling, like every chat composer; beyond it
          // the textarea scrolls rather than pushing the controls off screen.
          const el = event.target;
          el.style.height = 'auto';
          el.style.height = `${String(Math.min(el.scrollHeight, 320))}px`;
        }}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter breaks the line — the convention everywhere else.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      {mode === 'brownfield' && (
        <input
          className="composer__repo mono"
          type="text"
          value={repoPath}
          placeholder="/path/to/checkout"
          aria-label="Repository path"
          onChange={(event) => {
            setRepoPath(event.target.value);
          }}
        />
      )}

      <div className="composer__bar">
        <div className="composer__modes" role="group" aria-label="Mode">
          {(['greenfield', 'brownfield'] as const).map((value) => (
            <button
              className={`composer__mode${mode === value ? ' is-on' : ''}`}
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
              }}
            >
              {value === 'greenfield' ? 'New code' : 'Existing repo'}
            </button>
          ))}
        </div>

        <span className="composer__hint">
          {mode === 'brownfield'
            ? 'Scans the repo first; claims about existing code get verified'
            : 'Straight to requirements'}
        </span>

        <button
          className="composer__send"
          type="submit"
          disabled={!ready || pending}
          aria-label="Start the spec"
        >
          {pending ? '…' : '↑'}
        </button>
      </div>

      {error !== null && (
        <ErrorNote
          className="composer__error"
          error={error}
          onRetry={() => {
            void submit();
          }}
        />
      )}
    </form>
  );
}
