-- Better Auth 1.7 OAuth provider (@better-auth/mcp + @better-auth/cimd) — v13.
-- Numbered migration. Never edit once applied; add a new file for changes.
--
-- PURELY ADDITIVE. Production D1 migrations are applied by hand and merging to
-- main deploys the Worker, so this migration must be safe to apply while the
-- Better Auth 1.6 Worker is still live, at any time before the merge:
--   - The 1.6 MCP tables (oauthApplication, oauthAccessToken, oauthConsent) are
--     NOT touched. The 1.6 Worker keeps reading and writing them.
--   - The new provider's tables are new names. Two of its models share names
--     with 1.6 tables but not columns, so they are stored as
--     oauthProviderAccessToken and oauthProviderConsent
--     (OAUTH_PROVIDER_SCHEMA in src/worker/betterAuth.ts).
--   - jwks gains two nullable columns the 1.7 jwt plugin records; 1.6 ignores
--     them and existing RS256 keys keep working with NULL.
--
-- Existing connections: the new Worker copies each 1.6 client, its consents and
-- its refresh token into the new tables the first time the client shows up
-- (src/worker/oauthLegacy.ts). SQLite cannot compute the SHA-256 hashes the new
-- provider stores, which is why that happens in the Worker and not here. A
-- later migration drops the 1.6 tables once their refresh tokens have expired.
--
-- The statements below are exactly what getMigrations() from
-- better-auth/db/migration emits for the configuration in betterAuth.ts;
-- src/worker/oauthProvider.test.ts fails if the two drift apart.

ALTER TABLE "jwks" ADD COLUMN "alg" text;
ALTER TABLE "jwks" ADD COLUMN "crv" text;

CREATE TABLE "oauthClient" ("id" text not null primary key, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" integer, "skipConsent" integer, "enableEndSession" integer, "subjectType" text, "scopes" text, "clientCredentialsScopes" text, "userId" text references "user" ("id") on delete cascade, "createdAt" date, "updatedAt" date, "name" text, "uri" text, "icon" text, "contacts" text, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" text not null, "postLogoutRedirectUris" text, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" integer, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" text, "responseTypes" text, "requirePKCE" integer, "dpopBoundAccessTokens" integer, "referenceId" text, "metadata" text);
CREATE TABLE "oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" text, "customClaims" text, "dpopBoundAccessTokensRequired" integer, "disabled" integer, "createdAt" date, "updatedAt" date, "policyVersion" integer, "metadata" text);
CREATE TABLE "oauthClientResource" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "resourceId" text not null references "oauthResource" ("identifier") on delete cascade, "metadata" text, "createdAt" date);
CREATE TABLE "oauthRefreshToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text not null references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "rotatedAt" date, "rotationReplayResponse" text, "rotationReplayExpiresAt" date, "authTime" date, "confirmation" text, "scopes" text not null);
CREATE TABLE "oauthProviderAccessToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "refreshId" text references "oauthRefreshToken" ("id") on delete cascade, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "confirmation" text, "scopes" text not null);
CREATE TABLE "oauthProviderConsent" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "resources" text, "requestedUserInfoClaims" text, "scopes" text not null, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE "oauthClientAssertion" ("id" text not null primary key, "expiresAt" date not null);

CREATE INDEX "oauthClient_userId_idx" ON "oauthClient" ("userId");
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource" ("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource" ("resourceId");
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken" ("clientId");
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken" ("sessionId");
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken" ("userId");
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken" ("authorizationCodeId");
CREATE INDEX "oauthProviderAccessToken_clientId_idx" ON "oauthProviderAccessToken" ("clientId");
CREATE INDEX "oauthProviderAccessToken_sessionId_idx" ON "oauthProviderAccessToken" ("sessionId");
CREATE INDEX "oauthProviderAccessToken_userId_idx" ON "oauthProviderAccessToken" ("userId");
CREATE INDEX "oauthProviderAccessToken_authorizationCodeId_idx" ON "oauthProviderAccessToken" ("authorizationCodeId");
CREATE INDEX "oauthProviderAccessToken_refreshId_idx" ON "oauthProviderAccessToken" ("refreshId");
CREATE INDEX "oauthProviderConsent_clientId_idx" ON "oauthProviderConsent" ("clientId");
CREATE INDEX "oauthProviderConsent_userId_idx" ON "oauthProviderConsent" ("userId");
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON "oauthClientResource" ("clientId", "resourceId");
