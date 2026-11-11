'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentForgeError, createClient, type ApprovalDecision } from '@agentforge/contract';

/**
 * The decision panel.
 *
 * This is the one screen where the product's central claim is exercised by a person, so
 * two things are deliberate:
 *
 * **The content hash is shown, not hidden.** A reviewer is approving specific bytes, and
 * the hash is what the approval binds to. Putting it on screen is what makes the binding
 * a visible property rather than an implementation detail.
 *
 * **A stale hash is explained, not retried.** If the artifact changed while the page was
 * open, the server answers `HASH_MISMATCH` with 409 and nothing moves. The panel does
 * not silently refetch and resubmit — that would approve bytes the reviewer never read,
 * which is precisely the failure the hash binding exists to prevent. It says what
 * happened and asks them to reload.
 */

const client = createClient();

export interface DecidePanelProps {
  readonly specId: string;
  readonly kind: 'context' | 'requirements' | 'design' | 'tasks';
  readonly contentHash: string;
  readonly version: number;
  readonly expectedVersion: number;
}

const DECISIONS: readonly { value: ApprovalDecision; label: string; hint: string }[] = [
  {
    value: 'approve',
    label: 'Approve',
    hint: 'Binds your account and this content hash into the audit log, permanently.',
  },
  {
    value: 'request_changes',
    label: 'Request changes',
    hint: 'Returns the spec to drafting so the agent can revise it.',
  },
  {
    value: 'reject',
    label: 'Reject',
    hint: 'Returns the spec to drafting and records the rejection.',
  },
];

export function DecidePanel({
  specId,
  kind,
  contentHash,
  version,
  expectedVersion,
}: DecidePanelProps) {
  const router = useRouter();
  const commentId = useId();
  const errorId = useId();

  const [decision, setDecision] = useState<ApprovalDecision>('approve');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    setPending(true);

    try {
      await client.decideArtifact(specId, kind, {
        content_hash: contentHash,
        decision,
        comment: comment.trim().length === 0 ? null : comment.trim(),
        expected_version: expectedVersion,
      });

      router.refresh();
      router.push(`/specs/${specId}`);
    } catch (caught) {
      if (caught instanceof AgentForgeError) {
        // Branching on the taxonomy rather than on message text, which is exactly what
        // the typed client exists for.
        setError(
          caught.code === 'HASH_MISMATCH'
            ? 'This artifact changed since the page was loaded, so the decision was refused ' +
                'and nothing moved. Reload and read the current version before deciding.'
            : caught.code === 'VERSION_CONFLICT'
              ? 'Someone else changed this spec while the page was open. Reload to see where ' +
                'it got to.'
              : caught.message,
        );
      } else {
        setError('The decision could not be recorded. Nothing was changed.');
      }
      setPending(false);
    }
  }

  const selected = DECISIONS.find((item) => item.value === decision);

  return (
    <section className="decide" aria-labelledby={`${commentId}-heading`}>
      <h2 className="decide__title" id={`${commentId}-heading`}>
        Record a decision
      </h2>

      <p className="decide__bind">
        Binding to <code>{contentHash.slice(0, 16)}…</code> (v{version})
      </p>

      <fieldset className="decide__options">
        <legend className="visually-hidden">Decision</legend>
        {DECISIONS.map((item) => (
          <label className="decide__option" key={item.value}>
            <input
              type="radio"
              name="decision"
              value={item.value}
              checked={decision === item.value}
              onChange={() => {
                setDecision(item.value);
              }}
            />
            <span className="decide__optionLabel">{item.label}</span>
          </label>
        ))}
      </fieldset>

      {selected !== undefined && <p className="decide__hint">{selected.hint}</p>}

      <div className="field">
        <label htmlFor={commentId}>Comment</label>
        <textarea
          className="input decide__comment"
          id={commentId}
          rows={3}
          value={comment}
          onChange={(event) => {
            setComment(event.target.value);
          }}
          placeholder={
            decision === 'approve'
              ? 'Optional. Why this is good to build.'
              : 'What needs to change, and why.'
          }
        />
        <span className="field__hint">
          Recorded in the audit log alongside your name and the hash above.
        </span>
      </div>

      {error !== null && (
        <p className="authForm__error" id={errorId} role="alert">
          {error}
        </p>
      )}

      <button
        className="btn btn--accent"
        type="button"
        disabled={pending}
        onClick={() => {
          void submit();
        }}
      >
        {pending ? 'Recording…' : `${selected?.label ?? 'Submit'} this version`}
      </button>
    </section>
  );
}
