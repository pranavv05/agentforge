'use client';

import { useId, useState } from 'react';
import { announce, focusMain } from '@/components/workspace/announcer';
import { useRouter } from 'next/navigation';
import { AgentForgeError, createClient, type ApprovalDecision } from '@agentforge/contract';

/**
 * Recording a decision.
 *
 * A stale hash is explained, not retried. If the artifact changed while the pane was
 * open the server answers `HASH_MISMATCH` with 409 and nothing moves; this does not
 * silently refetch and resubmit, because that would approve bytes the reviewer never
 * read — precisely the failure the hash binding exists to prevent.
 *
 * It branches on the error *code* from the typed client rather than on message text,
 * which is what that client is for.
 */

const client = createClient();

const DECISIONS: readonly { value: ApprovalDecision; label: string; hint: string }[] = [
  {
    value: 'approve',
    label: 'Approve',
    hint: 'Binds your account and this hash into the audit log, permanently.',
  },
  {
    value: 'request_changes',
    label: 'Request changes',
    hint: 'Returns the spec to drafting so the agent can revise it.',
  },
  { value: 'reject', label: 'Reject', hint: 'Returns the spec to drafting and records it.' },
];

export function DecideControls({
  specId,
  kind,
  contentHash,
  expectedVersion,
}: {
  specId: string;
  kind: 'context' | 'requirements' | 'design' | 'tasks';
  contentHash: string;
  expectedVersion: number;
}) {
  const router = useRouter();
  const commentId = useId();

  const [decision, setDecision] = useState<ApprovalDecision>('approve');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = DECISIONS.find((item) => item.value === decision);

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
      router.push(`/workspace/${specId}`);
      announce(
        decision === 'approve'
          ? 'Approved. The decision is recorded against this content hash.'
          : 'Changes requested. The agent will redraft.',
      );
      // The control that had focus is about to unmount; without this focus falls to the
      // top of the page.
      window.setTimeout(focusMain, 0);
    } catch (caught) {
      if (caught instanceof AgentForgeError) {
        setError(
          caught.code === 'HASH_MISMATCH'
            ? 'This artifact changed since the pane was opened, so the decision was refused ' +
                'and nothing moved. Reload and read the current version before deciding.'
            : caught.code === 'VERSION_CONFLICT'
              ? 'Someone else moved this spec while the pane was open. Reload to see where ' +
                'it got to.'
              : caught.message,
        );
      } else {
        setError('The decision could not be recorded. Nothing was changed.');
      }
      setPending(false);
    }
  }

  return (
    <section className="decide" aria-label="Record a decision">
      <div className="decide__row" role="group" aria-label="Decision">
        {DECISIONS.map((item) => (
          <button
            className={`decide__opt${decision === item.value ? ' is-on' : ''}`}
            key={item.value}
            type="button"
            aria-pressed={decision === item.value}
            onClick={() => {
              setDecision(item.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {selected !== undefined && <p className="decide__hint">{selected.hint}</p>}

      <label className="visually-hidden" htmlFor={commentId}>
        Comment
      </label>
      <textarea
        className="decide__comment"
        id={commentId}
        rows={2}
        value={comment}
        placeholder={
          decision === 'approve' ? 'Comment (optional)' : 'What needs to change, and why?'
        }
        onChange={(event) => {
          setComment(event.target.value);
        }}
      />

      {error !== null && (
        <p className="decide__error" role="alert">
          {error}
        </p>
      )}

      <button
        className="decide__go"
        type="button"
        disabled={pending}
        onClick={() => {
          void submit();
        }}
      >
        {pending ? 'Recording…' : `${selected?.label ?? 'Submit'} — bind to this hash`}
      </button>
    </section>
  );
}
