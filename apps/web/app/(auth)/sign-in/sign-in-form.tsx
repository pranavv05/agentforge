'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth-client';

/**
 * The sign-in form.
 *
 * Deliberately plain HTML: a real `<form>`, real `<label for>` pairs, a real submit
 * button. It works with the keyboard because it is made of the elements that already
 * do, not because focus handling was added afterwards.
 *
 * The error message is intentionally the same whichever half of the credentials was
 * wrong. "No such account" and "wrong password" answer different questions for someone
 * working through a list of addresses, and this is the one screen where a more helpful
 * message is a disclosure.
 */
export function SignInForm() {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    setPending(true);

    const result = await signIn.email({ email, password });

    if (result.error !== null) {
      setError('That email and password do not match an account.');
      setPending(false);
      return;
    }

    // `refresh()` before navigating, so the server components on the destination read
    // the new session rather than a cached anonymous render.
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
          aria-invalid={error !== null}
          {...(error === null ? {} : { 'aria-describedby': errorId })}
        />
      </div>

      <div className="field">
        <label htmlFor={passwordId}>Password</label>
        <input
          className="input"
          id={passwordId}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          aria-invalid={error !== null}
          {...(error === null ? {} : { 'aria-describedby': errorId })}
        />
      </div>

      {/*
        `role="alert"` so a screen reader announces the failure without the user having to
        go looking for it. Rendered only when there is something to say, so it does not
        announce an empty string on mount.
      */}
      {error !== null && (
        <p className="authForm__error" id={errorId} role="alert">
          {error}
        </p>
      )}

      <button className="btn btn--accent authForm__submit" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
