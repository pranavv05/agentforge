'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUp } from '@/lib/auth-client';

/**
 * The sign-up form.
 *
 * `MIN_PASSWORD` mirrors `minPasswordLength` in the auth config. Validating here is a
 * courtesy that saves a round trip; the server enforces it regardless, because a client
 * check is a convenience and never a control.
 *
 * Unlike sign-in, the error here *is* specific. Telling someone their password is too
 * short, or that an address is already registered, discloses nothing they could not
 * learn by trying — and withholding it just makes the form impossible to complete.
 */

const MIN_PASSWORD = 12;

export function SignUpForm() {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const roleId = useId();
  const errorId = useId();
  const hintId = useId();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('reviewer');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${String(MIN_PASSWORD)} characters.`);
      return;
    }

    setPending(true);

    const result = await signUp.email({ email, password, name, role });

    if (result.error !== null) {
      const message = result.error.message ?? '';
      setError(
        message.toLowerCase().includes('exist')
          ? 'An account already exists for that email.'
          : message.length > 0
            ? message
            : 'Could not create the account. Please try again.',
      );
      setPending(false);
      return;
    }

    router.refresh();
    router.push('/specs');
  }

  return (
    <form
      className="authForm"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // Braces, and `void`: the attribute expects a void return, and handing it a
        // promise means an unhandled rejection has nowhere to surface.
        void submit();
      }}
    >
      <div className="field">
        <label htmlFor={nameId}>Name</label>
        <input
          className="input"
          id={nameId}
          type="text"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <span className="field__hint">Shown beside your decisions in the audit timeline.</span>
      </div>

      <div className="field">
        <label htmlFor={emailId}>Email</label>
        <input
          className="input"
          id={emailId}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={passwordId}>Password</label>
        <input
          className="input"
          id={passwordId}
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          aria-describedby={hintId}
          aria-invalid={error !== null}
        />
        <span className="field__hint" id={hintId}>
          At least {MIN_PASSWORD} characters.
        </span>
      </div>

      <div className="field">
        <label htmlFor={roleId}>Role</label>
        <select
          className="input"
          id={roleId}
          name="role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
          }}
        >
          <option value="reviewer">Reviewer</option>
          <option value="developer">Developer</option>
          <option value="compliance">Compliance</option>
        </select>
        <span className="field__hint">
          A label for the timeline. It does not grant or restrict anything — approval rules live in
          the orchestrator.
        </span>
      </div>

      {error !== null && (
        <p className="authForm__error" id={errorId} role="alert">
          {error}
        </p>
      )}

      <button className="btn btn--accent authForm__submit" type="submit" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
