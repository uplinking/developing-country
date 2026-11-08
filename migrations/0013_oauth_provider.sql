-- Better Auth 1.7 OAuth provider (@better-auth/mcp + @better-auth/cimd) — v13.
-- Numbered migration. Never edit once applied; add a new file for changes.
--
-- WHY. Better Auth 1.7 removed the built-in mcp()/oidcProvider() plugins. Their
-- replacement (@better-auth/oauth-provider, wrapped by @better-auth/mcp) uses a
-- different schema: clients live in `oauthClient`, refresh tokens get their own
-- `oauthRefreshToken` table, and tokens and client secrets are stored as
-- SHA-256 hashes instead of plaintext. The old and new `oauthAccessToken` /
-- `oauthConsent` tables share names but not columns.
--
-- HOW EXISTING CONNECTIONS SURVIVE. This migration keeps every old row: the
-- three old tables are renamed to legacyOauth*, untouched. SQLite cannot hash,
-- so the rows are NOT copied here. Instead the Worker moves each old client,
-- its refresh tokens and its consents into the new tables the first time that
-- client shows up (src/worker/oauthLegacy.ts), hashing them exactly as the new
-- provider does. Old access tokens are honoured read-only until they expire
-- (at most an hour). Nobody has to reconnect.
--
-- The new tables below are exactly what `getMigrations()` from
-- better-auth/db/migration emits for the configuration in
-- src/worker/betterAuth.ts. src/worker/oauthProvider.test.ts re-runs that diff
-- against every migration and fails if the schema drifts.

-- 1. Park the old tables. Their indexes are dropped first because the new
--    tables reuse two of the names; the UNIQUE constraints (and therefore the
--    lookups the legacy bridge needs) stay.
DROP INDEX IF EXISTS "oauthApplication_userId_idx";
DROP INDEX IF EXISTS "oauthAccessToken_clientId_idx";
DROP INDEX IF EXISTS "oauthAccessToken_userId_idx";
DROP INDEX IF EXISTS "oauthConsent_clientId_idx";
DROP INDEX IF EXISTS "oauthConsent_userId_idx";
ALTER TABLE "oauthApplication" RENAME TO "legacyOauthApplication";
ALTER TABLE "oauthAccessToken" RENAME TO "legacyOauthAccessToken";
ALTER TABLE "oauthConsent" RENAME TO "legacyOauthConsent";

-- 2. jwt plugin 1.7 records each key's algorithm and curve. Existing RS256 keys
--    keep working with NULL here (the plugin falls back to its configured alg).
ALTER TABLE "jwks" ADD COLUMN "alg" TEXT;
ALTER TABLE "jwks" ADD COLUMN "crv" TEXT;

-- 3. OAuth provider schema.
CREATE TABLE "oauthClient" ("id" text not null primary key, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" integer, "skipConsent" integer, "enableEndSession" integer, "subjectType" text, "scopes" text, "clientCredentialsScopes" text, "userId" text references "user" ("id") on delete cascade, "createdAt" date, "updatedAt" date, "name" text, "uri" text, "icon" text, "contacts" text, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" text not null, "postLogoutRedirectUris" text, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" integer, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" text, "responseTypes" text, "requirePKCE" integer, "dpopBoundAccessTokens" integer, "referenceId" text, "metadata" text);
CREATE TABLE "oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" text, "customClaims" text, "dpopBoundAccessTokensRequired" integer, "disabled" integer, "createdAt" date, "updatedAt" date, "policyVersion" integer, "metadata" text);
CREATE TABLE "oauthClientResource" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "resourceId" text not null references "oauthResource" ("identifier") on delete cascade, "metadata" text, "createdAt" date);
CREATE TABLE "oauthRefreshToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text not null references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "rotatedAt" date, "rotationReplayResponse" text, "rotationReplayExpiresAt" date, "authTime" date, "confirmation" text, "scopes" text not null);
CREATE TABLE "oauthAccessToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "refreshId" text references "oauthRefreshToken" ("id") on delete cascade, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "confirmation" text, "scopes" text not null);
CREATE TABLE "oauthConsent" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "resources" text, "requestedUserInfoClaims" text, "scopes" text not null, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE "oauthClientAssertion" ("id" text not null primary key, "expiresAt" date not null);

CREATE INDEX "oauthClient_userId_idx" ON "oauthClient" ("userId");
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource" ("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource" ("resourceId");
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON "oauthClientResource" ("clientId", "resourceId");
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken" ("clientId");
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken" ("sessionId");
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken" ("userId");
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken" ("authorizationCodeId");
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken" ("clientId");
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken" ("sessionId");
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken" ("userId");
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken" ("authorizationCodeId");
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken" ("refreshId");
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent" ("clientId");
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent" ("userId");
