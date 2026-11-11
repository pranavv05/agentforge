'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentForgeError, createClient, type SpecMode } from '@agentforge/contract';

/**
 * Creating a spec.
 *
 * The mode choice is the only real decision on this form, and it is the one that changes
 * what the pipeline does: brownfield adds a repository scan and makes every later claim
 * about existing code subject to verification. So it is presented as two described
 * options rather than a select, and the repository path appears only when it is needed.
 */

const client = createClient();

export function CreateSpecForm() {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const repoId = useId();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<SpecMode>('greenfield');
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const ready =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    (mode === 'greenfield' || repoPath.trim().length > 0);

  async function submit(): Promise<void> {
    setError(null);
    setPending(true);

    try {
      const result = await client.createSpec({
        title: title.trim(),
        description: description.trim(),
        mode,
        repo_path: mode === 'brownfield' ? repoPath.trim() : null,
      });

      router.refresh();
      router.push(`/specs/${result.spec.id}`);
    } catch (caught) {
      setError(
        caught instanceof AgentForgeError
          ? caught.message
          : 'The spec could not be created. Nothing was saved.',
      );
      setPending(false);
    }
  }

  return (
    <form
      className="createForm"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="field">
        <label htmlFor={titleId}>Title</label>
        <input
          className="input"
          id={titleId}
          type="text"
          value={title}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={descriptionId}>Feature request</label>
        <textarea
          className="input"
          id={descriptionId}
          rows={6}
          value={description}
          maxLength={5000}
          placeholder="What should it do, and why? Plain prose is fine."
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <span className="field__hint">
          Hinglish and other mixed-language input is accepted; the documents are produced in
          English.
        </span>
      </div>

      <fieldset className="modeGroup">
        <legend className="field__legend">Mode</legend>

        <label className={`modeOption${mode === 'greenfield' ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name="mode"
            value="greenfield"
            checked={mode === 'greenfield'}
            onChange={() => {
              setMode('greenfield');
            }}
          />
          <span className="modeOption__body">
            <span className="modeOption__title">Greenfield</span>
            <span className="modeOption__note">
              Nothing exists yet. The pipeline goes straight to requirements.
            </span>
          </span>
        </label>

        <label className={`modeOption${mode === 'brownfield' ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name="mode"
            value="brownfield"
            checked={mode === 'brownfield'}
            onChange={() => {
              setMode('brownfield');
            }}
          />
          <span className="modeOption__body">
            <span className="modeOption__title">Brownfield</span>
            <span className="modeOption__note">
              Scans a repository first. Every claim about existing code then carries a file and line
              range that gets verified.
            </span>
          </span>
        </label>
      </fieldset>

      {mode === 'brownfield' && (
        <div className="field">
          <label htmlFor={repoId}>Repository path</label>
          <input
            className="input mono"
            id={repoId}
            type="text"
            value={repoPath}
            placeholder="/path/to/checkout"
            onChange={(event) => {
              setRepoPath(event.target.value);
            }}
          />
          <span className="field__hint">
            A local checkout the server can read. File access is confined to this root.
          </span>
        </div>
      )}

      {error !== null && (
        <p className="authForm__error" role="alert">
          {error}
        </p>
      )}

      <button className="btn btn--accent" type="submit" disabled={pending || !ready}>
        {pending ? 'Creating…' : 'Create spec'}
      </button>
    </form>
  );
}
