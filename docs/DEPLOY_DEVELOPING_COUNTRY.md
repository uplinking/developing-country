# Deploy developing-country.org

Deployment uses three Workers and two application hostnames:

| Host | Worker | Owns |
| --- | --- | --- |
| `developing-country.org` | `developing-country-site` | landing, country desks, Research Articles, RSS, EmDash admin/editorial MCP, CMS D1/R2 |
| `explore.developing-country.org` | `developing-country-explore` | explorer SPA, platform MCP/API/OAuth, immutable Data Views, platform D1 |
| Scheduled only | `developing-country-ingestion` | API archives, runtime dataset versions and six-hour refreshes |
| `tiles.developing-country.org` | R2 custom domain | direct public PMTiles range reads from `developing-country-tiles` |

The split is a release and CPU boundary, not two websites. A canonical
`https://explore.developing-country.org/views/view_…` URL is the shared object
between them.

The cached site entrypoint is custom-domain only. Its cache key is deliberately
safe without a hostname or cookie partition: public page markup never varies by
session, and canonical/SEO URLs are always rooted at `developing-country.org`.
The Worker wrapper additionally stamps `private, no-store` on every response
outside the public page allowlist, including admin, API, auth, preview-token,
and editorial MCP paths. This prevents Workers Cache heuristic freshness from
storing a response even when an upstream route forgot its own header. The only
non-page exception preserves an explicit upstream `public, …, immutable`
header for Astro assets and EmDash public media files, avoiding repeat Worker
and R2 reads without broadening the private-response boundary.

## Before the first deploy

1. Put the `developing-country.org` zone in the same Cloudflare account named by
   `wrangler.explore.jsonc`. Custom Domains require an active owned zone and no
   conflicting CNAME at either hostname.
2. Run `bunx wrangler whoami` and confirm the account before any mutation.
3. Add `https://explore.developing-country.org/api/auth/callback/google` and the
   equivalent GitHub callback to the provider consoles before switching OAuth.
4. Configure platform secrets with `bunx wrangler secret put --config
   wrangler.explore.jsonc <NAME>`: `BETTER_AUTH_SECRET` is required; provider
   client ids/secrets are optional pairs.
5. Create the dedicated immutable Query Snapshot bucket once with `bunx
   wrangler r2 bucket create developing-country-views`. The explorer binds it
   as `VIEWS`; it is separate from tiles and CMS media.
6. Create the site catalogue bucket once with `bunx wrangler r2 bucket create
   developing-country-data`. Generate and upload the exact content-addressed
   catalogue named by the build with `bun run --cwd apps/site
   data:catalog:upload:remote`. The site binds it as `DATASETS`; it is private
   and needs no custom domain or public access.
7. Attach `tiles.developing-country.org` to `developing-country-tiles`, apply
   `scripts/r2-tiles-cors.json`, and add one Cache Rule matching only
   `http.host eq "tiles.developing-country.org"` with cache eligibility on,
   Edge TTL overridden to one day, and Browser TTL overridden to one hour.
   `.pmtiles` is not a default cached extension and current keys can be updated
   in place, so this rule is both a cost control and the staleness boundary.
   Keep minimum TLS at 1.2 or newer.
8. Let the site’s first setup create the Admin, then create a separate agent
   identity with the **Contributor** role. Never promote it to Author.
9. In EmDash Admin, enable and explicitly consent to the configured
   `developing-country-blocks` MCP tool. Reconnect the agent client so its OAuth
   grant includes `content:write` and `mcp:tools:developing-country-blocks`.
   Confirm that
   `developing-country-blocks__publication_requirements` appears before asking
   an agent to submit its first draft.

Wrangler auto-provisions the site’s ID-less `SESSION` KV, CMS D1, media R2, and
Images bindings. The private `DATASETS` bucket is deliberately pre-created and
populated because the site fails closed if its checksummed catalogue is absent.
EmDash applies core CMS migrations. Platform migrations remain
append-only in the root `migrations/` directory. Migration `0008` freezes all
Data View claim fields and adds the R2 result pointer; apply it only after the
`developing-country-views` bucket exists. Migration `0009` adds hard per-owner,
hourly, and platform Data View storage ceilings. Migration `0010` indexes global
seven-day stage-snapshot cleanup. Migration `0011` reserves D1 headroom with a
separate 256 MiB ceiling for inline snapshots while larger snapshots remain in
R2.

The site has append-only project migrations in `apps/site/migrations/`.
Migration `0001_article_publication_evidence.sql` installs the
transport-independent Research Article evidence gate; `0002` aligns its raw
identifier, real-calendar, and uniqueness checks with the application
validator; `0003` adds the registry-owned dataset preview URL column and its
published-row layer/camera contract. On a new CMS database, upload the R2
catalogue, deploy the site, and let EmDash setup apply the generated
`apps/site/seed/runtime.json` so `ec_articles` exists. Then run
`bun run db:migrate:site:remote` and explicitly synchronize the reviewed
dataset notes from `apps/site/seed/seed.json` before allowing publication. On an existing
database the table already exists, so apply both migrations immediately before
the site release. Article scheduling is intentionally disabled; every live
revision must pass the gate at the human publish transition.

The migration upgrades the known pre-v1 seeded design note in place. Before an
existing-site rollout, review every other published `ec_articles` row and
unpublish anything that does not yet have the v1 evidence shape. The trigger
allows EmDash to stage a corrective draft revision, but it will reject the next
publish until the entire candidate is consistent. The same migration removes
the legacy `scheduling` capability from an already-initialized Research
collection and cancels any legacy scheduled publication. Scheduled-only rows
return to draft; published rows stay live with their pending draft revision
available for explicit review. Changing the seed alone would affect only a new
CMS.

## Validate without changing Cloudflare

```bash
bun run check
bun run dry-run:explore
bun run dry-run:site
bun run check:bundle-size          # or: bun run check:bundle-size --run
```

Both dry runs must remain below the Workers Free compressed-script ceiling.
Current measured sizes (2026-09-01) are 408.57 KiB for the explorer and
2,741.88 KiB for the Astro/EmDash site. The site has roughly 330 KiB of
compressed headroom below the 3 MiB limit and 158 KiB below this repo's
stricter 2,900 KiB guard; repeat the dry run on every
EmDash/Astro upgrade.

`scripts/check-bundle-size.mjs` turns those numbers into a hard gate with
explicit ceilings below the platform limit: **site ≤ 2900 KiB gzip, explorer
≤ 1024 KiB gzip**. It measures the modules Wrangler would upload (the explorer
bundle in `.wrangler/dry-run-explore/`, the site's `dist/server` modules via
the redirected `.wrangler/deploy/config.json`) and prints the top server
chunks so a regression points at a file. Pass `--explore-log` / `--site-log`
with captured dry-run output to cross-check Wrangler's own figure (the guard
uses the larger of the two), or `--run` to execute both dry runs first. GitHub
Actions (`.github/workflows/ci.yml`) runs `bun run check`, both dry runs, and
this guard on every pull request and push to `main`. After successful main checks, the release step uses the repository `CLOUDFLARE_API_TOKEN` secret to apply migrations, upload the immutable catalogue, deploy Explorer, site and ingestion Workers, and smoke-test production. PR runs cannot deploy. Superseded main commits skip release; a running release is never cancelled by a newer push. Note that Wrangler does not clear the site's
`--outdir`, so stale hashed chunks accumulate there; the guard deliberately
reads `apps/site/dist/server` instead.

## Deploy order

Main pushes deploy automatically after checks pass. For an explicitly authorized manual recovery, run `bun scripts/deploy-production.ts`; it follows this order:

```bash
bun run db:migrate:remote
bun run db:migrate:site:remote     # existing CMS DB; ec_articles must exist
bun run --cwd apps/site data:catalog:upload:remote
bun run deploy:explore
bun run --cwd apps/site deploy
bun run deploy:ingestion
# New CMS only, after setup and CMS migrations:
bun run --cwd apps/site content:sync-notes:remote
```

The current `0009`/`0010` platform migrations and CMS `0002` migration are
additive guards, so migration-first is safe. Future schema changes must use an
expand/contract sequence: add compatible schema, deploy a Worker that can read
both shapes, backfill, then remove the old shape in a later migration. Never
pair a destructive migration with a writer that requires it in the same
release, and never treat an older Worker deployment as a database rollback.

For a brand-new CMS DB only, deploy and initialize the runtime seed before the
CMS migration, then synchronize the full reviewed dataset notes. Complete both
steps before any Research Article is published.

Upload the immutable catalogue before the site Worker that references its
checksum. Deploy explorer first because new articles only accept its canonical live URLs.
Then smoke-test:

```bash
curl -I https://developing-country.org/
curl -I https://developing-country.org/research
curl -I https://explore.developing-country.org/
curl -I -H 'Origin: https://explore.developing-country.org' \
  -H 'Range: bytes=0-15' https://tiles.developing-country.org/roads.pmtiles
curl https://explore.developing-country.org/api/catalog
curl https://explore.developing-country.org/api/views/view_does_not_exist
```

Expected: public pages/catalog are `200`, the missing view is `404`, and both
MCP endpoints return an authentication challenge when called anonymously. The
tile request is `206`, exposes `Content-Range` and CORS headers, and should show
`CF-Cache-Status: HIT` on a repeated request after the cache rule is active.

## Cost posture

This architecture needs no Next.js host, headless-CMS SaaS, Dynamic Worker
Loader, Workers for Platforms, queue, or always-on server. It is designed for
Cloudflare’s scale-to-zero/free allowances:

- Workers Free currently includes 100,000 requests/day, 10 ms CPU/request, 100
  Workers, five Cron Triggers, and 3 MiB compressed per Worker. The site uses one
  hourly maintenance trigger and native Workers Cache so repeat public reads bypass SSR.
  Explorer JS/CSS/data bypass its Worker entirely; request-time graph traversal
  and all-pairs distance are explicitly disabled in the cost-capped deployment.
- D1 Free currently includes 5 million rows read/day, 100,000 rows written/day,
  5 GB total account storage, and a 500 MB maximum per database. Inline Data
  View snapshots stop at 256 MiB to preserve room for auth and platform data.
- R2 Standard includes 10 GB-month, 1 million Class A and 10 million Class B
  operations/month with no Internet egress fee. Data Views are capped at 8 MiB
  each, five creations/hour, 50 active views and 128 MiB per owner, plus 10,000
  immutable history rows and 2 GiB of active platform snapshots. Revocation
  removes the R2 object while retaining the audit row.

Authoritative limits: [Workers](https://developers.cloudflare.com/workers/platform/limits/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/), and
[R2](https://developers.cloudflare.com/r2/pricing/). Re-check them before making
budget decisions; they are operational facts, not architecture constants.

If traffic grows, add a dedicated object-cache KV only after D1 metrics justify
it. Do not split the public site from EmDash merely to chase hypothetical scale.

Code/data infrastructure deploys automatically; CMS editorial publication remains a separate human-controlled action. The CI token must cover Workers deployment, custom routes, R2 catalogue writes and D1 migrations for this account. A release failure stops subsequent steps and fails the GitHub run; deployments across Workers are sequential, not transactional. Re-run the current main workflow after resolving a failure.
