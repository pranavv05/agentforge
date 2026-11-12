'use client';

import { useState } from 'react';
import { ErrorNote } from '@/components/workspace/error-note';
import { explainError, type ErrorExplanation } from '@/components/workspace/explain-error';
import { useRouter } from 'next/navigation';
import { createClient } from '@agentforge/contract';

/**
 * Answering a clarification, in the thread.
 *
 * This is the one part of the pipeline that genuinely is a conversation — the agent asks,
 * a human answers, it redrafts — so it belongs in the thread rather than on a page of its
 * own.
 *
 * All open questions in a round submit together, because that is how the orchestrator
 * accepts them: a partial round would leave the agent redrafting against half an answer
 * set. The control therefore belongs to the round, not to each question, and it stays
 * disabled until every question has something in it.
 *
 * Suggested options fill the box rather than replacing it. The agent proposes them; the
 * reviewer should stay free to write something else, and often should.
 */

const client = createClient();

export interface OpenQuestion {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
}

export function AnswerInline({
  specId,
  specVersion,
  questions,
}: {
  specId: string;
  specVersion: number;
  questions: readonly OpenQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<ErrorExplanation | null>(null);
  const [pending, setPending] = useState(false);

  const complete = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  async function submit(): Promise<void> {
    if (!complete || pending) return;

    setError(null);
    setPending(true);

    try {
      await client.answerClarifications(specId, {
        answers: questions.map((q) => ({
          clarification_id: q.id,
          answer: (answers[q.id] ?? '').trim(),
        })),
        expected_version: specVersion,
      });

      router.refresh();
    } catch (caught) {
      setError(explainError(caught, 'The answers could not be recorded. Nothing was changed.'));
      setPending(false);
    }
  }

  return (
    <form
      className="ans"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {questions.map((q) => (
        <div className="ans__item" key={q.id}>
          <label className="ans__q" htmlFor={`ans-${q.id}`}>
            {q.question}
          </label>

          {q.options.length > 0 && (
            <div className="ans__opts">
              {q.options.map((option) => (
                <button
                  className="ans__opt"
                  key={option}
                  type="button"
                  onClick={() => {
                    setAnswers((prev) => ({ ...prev, [q.id]: option }));
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          <textarea
            className="ans__input"
            id={`ans-${q.id}`}
            rows={2}
            value={answers[q.id] ?? ''}
            placeholder="Your answer"
            onChange={(event) => {
              const { value } = event.target;
              setAnswers((prev) => ({ ...prev, [q.id]: value }));
            }}
          />
        </div>
      ))}

      {error !== null && (
        <ErrorNote
          className="ans__error"
          error={error}
          onRetry={() => {
            void submit();
          }}
        />
      )}

      <button className="ans__go" type="submit" disabled={!complete || pending}>
        {pending
          ? 'Recording…'
          : complete
            ? `Send ${String(questions.length)} answer${questions.length === 1 ? '' : 's'}`
            : 'Answer every question to continue'}
      </button>
    </form>
  );
}
