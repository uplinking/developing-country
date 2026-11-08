# Authentication and OAuth

The explorer uses [Better Auth](https://better-auth.com) inside the
`developing-country-explore` Cloudflare Worker. Browser users authenticate with
session cookies; MCP clients authenticate with OAuth 2.1 bearer tokens. Both are
backed by the `developing-country-platform` D1 database.

Production is root-mounted at `https://explore.developing-country.org`:

| Surface | Production URL |
| --- | --- |
| Web explorer | `https://explore.developing-country.org/` |
| Better Auth | `https://explore.developing-country.org/api/auth/*` |
| Platform MCP | `https://explore.developing-country.org/mcp` |
| OAuth discovery | `https://explore.developing-country.org/.well-known/*` |

Public datasets, map tiles, catalog reads, and saved public Data Views remain
public. Account data and mutations require identity. User-owned rows key on the
verified email address.

## Request flow

| Route | Handler | Identity |
| --- | --- | --- |
| `GET|POST /api/auth/*` | Better Auth | sign-up/in, callbacks, consent and token exchange |
| `/.well-known/*` | discovery aliases | public OAuth metadata |
| authenticated `/api/*` | platform API | session cookie |
| `POST /mcp` | platform MCP | OAuth bearer token |

`getAuth(env)` creates a Better Auth instance per request. Never cache it at
module scope: Workers bindings are request-scoped.

## Fail-closed modes

| Condition | Result |
| --- | --- |
| Valid session cookie or MCP bearer token | authenticated user |
| No session and `DEV_AUTH=1` | local-only `X-Dev-User` identity |
| No session and no explicit dev mode | `401` |

Never deploy `DEV_AUTH`. `GET /api/me` reports the active user and mode.

## Configuration

Non-secret values live in `wrangler.explore.jsonc`:

```json
{
  "BETTER_AUTH_URL": "https://explore.developing-country.org",
  "PUBLIC_VIEW_ORIGIN": "https://explore.developing-country.org",
  "BASE_PATH": ""
}
```

Worker secrets:

| Name | Required | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | yes | signs sessions and tokens |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional pair | Google login |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | optional pair | GitHub login |

Use the repository's Wrangler profile:

```bash
env -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_API_TOKEN \
  bunx wrangler secret put BETTER_AUTH_SECRET --config wrangler.explore.jsonc --profile uplinking
env -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_API_TOKEN \
  bunx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.explore.jsonc --profile uplinking
env -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_API_TOKEN \
  bunx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.explore.jsonc --profile uplinking
```

Local `.dev.vars` is gitignored:

```dotenv
DEV_AUTH="1"
BETTER_AUTH_SECRET="<random hex>"
BETTER_AUTH_URL="http://localhost:8787"
```

Run `bun run cf:dev`. The Worker loads `.dev.vars` and listens on port 8787.

## Database migrations

Better Auth and MCP OAuth tables are append-only migrations in `migrations/`.
Apply them with:

```bash
bun run db:migrate:local
bun run db:migrate:remote -- --profile uplinking
```

Never edit an applied migration. Change the auth schema by adding a new numbered
migration.

`0013_oauth_provider.sql` adds Better Auth 1.7's OAuth provider tables. It is
purely additive: the 1.6 tables (`oauthApplication`, `oauthAccessToken`,
`oauthConsent`) are not touched, and the provider's own access-token and
consent tables are named `oauthProviderAccessToken` and `oauthProviderConsent`
to avoid the clash. Apply it to production any time before the Worker that
needs it is deployed; the 1.6 Worker keeps working on a migrated database.

The new Worker moves each 1.6 client, its consents and its refresh token into
the new tables the first time the client uses them
(`src/worker/oauthLegacy.ts`). If it runs before 0013 is applied, every
`/api/auth/*` route and the OAuth discovery documents answer `503` naming the
missing migration, and nothing is written.

Once every row in `oauthAccessToken` (the 1.6 table) has a
`refreshTokenExpiresAt` in the past, drop the three 1.6 tables in a later
migration.

## Social provider callbacks

Register these exact production callbacks with the providers:

- Google: `https://explore.developing-country.org/api/auth/callback/google`
- GitHub: `https://explore.developing-country.org/api/auth/callback/github`

The corresponding sign-in button appears only when both secrets for that
provider are present.

Google sign-in uses the dedicated **Developing Country** Google Cloud project
(`eveloping-country-org`) and the **Developing Country Explorer** web OAuth
client. Its production JavaScript origin is
`https://explore.developing-country.org`. The client ID and secret are stored
as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the
`developing-country-explore` Worker; do not put the secret in this repository.
The public homepage is `https://developing-country.org`, and the authorised
domain is `developing-country.org`.

After changing domains or moving to a new Worker, verify both the callback
registration and the destination Worker's secrets. `GET /api/auth-providers`
must include `google`; an empty list means the credential pair is missing,
even if Google Console already has the correct callback.

The JWT plugin also encrypts its stored signing private key with
`BETTER_AUTH_SECRET`. Reusing the platform database with a different auth
secret can make authenticated `GET /api/auth/get-session` fail with
`Failed to decrypt private key`, even after Google successfully redirects
back. Keep the auth secret stable when moving Workers. If the original secret
cannot be restored, rotate the affected signing key with an authorised
database operation: record the newest `jwks` row's id and previous expiry,
set that row's `expiresAt` to a past Unix timestamp **in milliseconds**, then
make an authenticated session request so Better Auth creates a new encrypted
key. Preserve the old row; the plugin retains its public key for its default
30-day verification grace period. Do not disable private-key encryption or
delete users and sessions to work around this error.

## Deployment checks

Before deployment, run `bun run check`, `bun run dry-run:explore`, and
`bun run check:bundle-size`. After deployment verify discovery, an
unauthenticated MCP `401` with `WWW-Authenticate`, browser sign-in, consent,
token exchange, and one authenticated tool call. See `docs/MCP.md`.
