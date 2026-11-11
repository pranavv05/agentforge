-- Authentication tables.
--
-- These four tables are **owned by Better Auth**, and their shape is dictated by the
-- library rather than chosen here. The DDL below is what `@better-auth/cli generate`
-- produced for this configuration, kept verbatim: the camelCase column names and the
-- `date` type names do not match this project's snake_case convention, and that is
-- deliberate. Renaming them would mean maintaining a field-by-field mapping in the auth
-- config, and a single mistake there is a login that fails at runtime rather than a
-- compile error. A vendored third-party schema is better left recognisable.
--
-- Do not hand-edit to add a column. Change `apps/web/lib/auth.ts`, re-run the generator,
-- and add a new migration with whatever it produces.
--
-- **Why `audit_log.actor` is text and not a foreign key to `user`.** The audit log has to
-- outlive the people in it. If approvals pointed at `user.id` with a cascade, deleting a
-- departed reviewer would erase the record of what they approved; with a restrict, it
-- would make the row undeletable. Neither is right for a log whose purpose is to be
-- permanent evidence. So the actor identity is copied in as text at the moment of the
-- decision, and stays correct regardless of what later happens to the account.

CREATE TABLE "user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL,
  "image" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  -- Display only. Authorisation lives in the transition table, not here: see the note
  -- on `user.additionalFields.role` in apps/web/lib/auth.ts.
  "role" text
);

CREATE TABLE "session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" date NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  -- The password hash. Better Auth hashes with scrypt before it reaches this column.
  "password" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);

CREATE TABLE "verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" date NOT NULL,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);

CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

-- Sessions are looked up by token on every authenticated request, which is the hottest
-- read in the application. UNIQUE already indexes it; this is here only as a reminder
-- that the lookup is indexed and must stay that way.
CREATE INDEX IF NOT EXISTS "session_token_idx" ON "session" ("token");
