-- Better Auth schema — v4 (email/password + social + MCP OAuth provider).
-- Numbered migration. Never edit once applied; add a new file for changes.
--
-- Tables emitted by `@better-auth/cli generate` for betterAuth({...}) with
-- emailAndPassword + google/github socialProviders + the mcp() plugin:
--   user, session, account, verification   → core auth
--   oauthApplication, oauthAccessToken, oauthConsent → MCP OAuth 2.1 provider
-- Identity for the rest of the platform keys on user.email (unchanged), so no
-- data migration of the existing prospects/issues/contributions rows is needed.
--
-- CREATE TABLE IF NOT EXISTS keeps this idempotent/self-safe. `date`/`integer`
-- are the affinities Better Auth's SQLite (D1) adapter expects.

CREATE TABLE IF NOT EXISTS "user" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "email"         TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image"         TEXT,
  "createdAt"     DATE NOT NULL,
  "updatedAt"     DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL,
  "token"     TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId"    TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "accountId"             TEXT NOT NULL,
  "providerId"            TEXT NOT NULL,
  "userId"                TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  DATE,
  "refreshTokenExpiresAt" DATE,
  "scope"                 TEXT,
  "password"              TEXT,
  "createdAt"             DATE NOT NULL,
  "updatedAt"             DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "expiresAt"  DATE NOT NULL,
  "createdAt"  DATE NOT NULL,
  "updatedAt"  DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "oauthApplication" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "icon"         TEXT,
  "metadata"     TEXT,
  "clientId"     TEXT NOT NULL UNIQUE,
  "clientSecret" TEXT,
  "redirectUrls" TEXT NOT NULL,
  "type"         TEXT NOT NULL,
  "disabled"     INTEGER,
  "userId"       TEXT REFERENCES "user" ("id") ON DELETE CASCADE,
  "createdAt"    DATE NOT NULL,
  "updatedAt"    DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "accessToken"           TEXT NOT NULL UNIQUE,
  "refreshToken"          TEXT NOT NULL UNIQUE,
  "accessTokenExpiresAt"  DATE NOT NULL,
  "refreshTokenExpiresAt" DATE NOT NULL,
  "clientId"              TEXT NOT NULL REFERENCES "oauthApplication" ("clientId") ON DELETE CASCADE,
  "userId"                TEXT REFERENCES "user" ("id") ON DELETE CASCADE,
  "scopes"                TEXT NOT NULL,
  "createdAt"             DATE NOT NULL,
  "updatedAt"             DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "oauthConsent" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "clientId"     TEXT NOT NULL REFERENCES "oauthApplication" ("clientId") ON DELETE CASCADE,
  "userId"       TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "scopes"       TEXT NOT NULL,
  "createdAt"    DATE NOT NULL,
  "updatedAt"    DATE NOT NULL,
  "consentGiven" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "session_userId_idx"           ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx"           ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx"  ON "verification" ("identifier");
CREATE INDEX IF NOT EXISTS "oauthApplication_userId_idx"  ON "oauthApplication" ("userId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_clientId_idx" ON "oauthAccessToken" ("clientId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_userId_idx"  ON "oauthAccessToken" ("userId");
CREATE INDEX IF NOT EXISTS "oauthConsent_clientId_idx"    ON "oauthConsent" ("clientId");
CREATE INDEX IF NOT EXISTS "oauthConsent_userId_idx"      ON "oauthConsent" ("userId");
