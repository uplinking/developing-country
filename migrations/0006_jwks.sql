-- JWKS key store for the Better Auth `jwt()` plugin — v5.
-- Numbered migration. Never edit once applied; add a new file for changes.
--
-- WHY. The mcp() plugin's OAuth discovery document hardcodes
--   id_token_signing_alg_values_supported: ["RS256"]
--   jwks_uri: <base>/mcp/jwks
-- but WITHOUT the jwt plugin the oidc-provider actually signs the id_token
-- HS256 with the client's secret, and the plugin registers no /mcp/jwks route
-- at all. A client that believes the metadata (claude.ai's connector) fetches
-- an absent key set, cannot verify an id_token that is not RS256 anyway, and
-- aborts the connection AFTER a successful token exchange. Adding the jwt
-- plugin + `oidcConfig.useJWTPlugin` makes the advertised metadata true: real
-- RS256 signatures against a real published key set.
--
-- Fields are exactly those of better-auth's jwt schema (publicKey, privateKey,
-- createdAt, expiresAt). The plugin creates the first key pair on demand.
-- CREATE TABLE IF NOT EXISTS keeps this idempotent/self-safe.

CREATE TABLE IF NOT EXISTS "jwks" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "publicKey"  TEXT NOT NULL,
  "privateKey" TEXT NOT NULL,
  "createdAt"  DATE NOT NULL,
  "expiresAt"  DATE
);
