'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentForgeError, createClient } from '@agentforge/contract';

/**
 * Answering a clarification round.
 *
 * All questions in a round are submitted together, because that is how the orchestrator
 * accepts them: a partial round would leave the agent redrafting against half an answer
 * set. The submit button stays disabled until every question has something in it, so the
 * incomplete case is prevented rather than rejected.
 *
 * Suggested options are buttons that fill the box, not radios that replace it. The agent
 * proposes options; the reviewer is free to write something else, and frequently should.
 */

const client = createClient();

export interface Question {
  readonly id: string;
  readonly question: string;
  readonly whyItMatters: string;
  readonly options: readonly string[];
}

export function AnswerForm({
  specId,
  expectedVersion,
  questions,
}: {
  specId: string;
  expectedVersion: number;
  questions: readonly Question[];
}) {
  const router = useRouter();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const complete = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  async function submit(): Promise<void> {
    setError(null);
    setPending(true);

    try {
      await client.answerClarifications(specId, {
        answers: questions.map((q) => ({
          clarification_id: q.id,
          answer: (answers[q.id] ?? '').trim(),
        })),
        expected_version: expectedVersion,
      });

      router.refresh();
      router.push(`/specs/${specId}`);
    } catch (caught) {
      setError(
        caught instanceof AgentForgeError
          ? caught.code === 'VERSION_CONFLICT'
            ? 'This spec moved while the page was open. Reload to see where it got to.'
            : caught.message
          : 'The answers could not be recorded. Nothing was changed.',
      );
      setPending(false);
    }
  }

  return (
    <form
      className="answerForm"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {questions.map((q) => (
        <div className="qa qa--open" key={q.id}>
          <label className="qa__question" htmlFor={`answer-${q.id}`}>
            {q.question}
          </label>
          <p className="qa__why">{q.whyItMatters}</p>

          {q.options.length > 0 && (
            <div className="qa__options">
              {q.options.map((option) => (
                <button
                  className="qa__option"
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
            className="input qa__input"
            id={`answer-${q.id}`}
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
        <p className="authForm__error" role="alert">
          {error}
        </p>
      )}

      <button className="btn btn--accent" type="submit" disabled={pending || !complete}>
        {pending
          ? 'Recording…'
          : complete
            ? `Submit ${String(questions.length)} answer${questions.length === 1 ? '' : 's'}`
            : 'Answer every question to continue'}
      </button>
    </form>
  );
}
