# ADR 0007: Gate Research Article publication in CMS D1

- Status: accepted
- Date: 2026-08-26

## Context

Contributor RBAC prevents an agent from publishing, but it does not ensure that
a human editor receives a complete, internally consistent evidence package.
EmDash 0.35 exposes save-time and after-publish plugin hooks, not an abortable
before-publish hook. Enforcing only in the admin UI or one HTTP route would also
leave MCP, REST, scheduled jobs, seed imports, or future transports as bypasses.

## Decision

Published Research Articles use Evidence Bundle version 1. A `platform-query`
bundle cites immutable Dataset Versions and every interactive Data View by its
canonical URL, Query id, and result checksum. Every Dataset Version Source id
resolves to an HTTPS Source-manifest row. A non-empirical `design-note` may cite
no Dataset Versions but still names its platform-design source. The article also
states its research question and methodology; primary/body Data Views must be
canonical and evidenced. (Amended by ADR 0009 and CMS migration `0063`: every interactive block's
view URL, including scrolly steps, must be evidenced, and a view may be reused across blocks.)

The pure validator in `apps/site/src/publicationEvidence.ts` drives tests and
seed validation. CMS D1 migrations `0001_article_publication_evidence.sql` and
the append-only `0002_strict_publication_evidence.sql` are the hard
security/integrity boundary: `BEFORE INSERT` and `BEFORE UPDATE` triggers abort
any `published` candidate that lacks the structural evidence contract, exact
raw identifiers, real calendar values, or unique evidence identities.
The update trigger covers status and every governed article field, so a direct
post-publication content edit cannot remove the evidence. It deliberately does
not run when EmDash only stages a draft-revision pointer; that allows an old
live row to be corrected or unpublished. Because EmDash promotes revision
fields and status in one statement, the trigger sees the exact publish candidate
atomically. It covers admin, REST, MCP, and future publish transports without
duplicating EmDash authentication.

The configured CMS plugin exposes the same authoring contract as the
authenticated, non-destructive MCP tool
`developing-country-blocks__publication_requirements`. It requires Contributor
or higher RBAC, explicit plugin-tool consent, and its plugin-specific MCP OAuth
scope. This is discovery assistance, not the enforcement boundary.

Research Article scheduling is disabled. This avoids validating a schedule and
then publishing materially changed evidence later without another human gate.
Drafts remain unconstrained so agents and editors can work incrementally.

The gate proves structural consistency inside CMS D1. It cannot prove that a
syntactically valid Dataset Version, Query id, or checksum actually exists in
the separately deployed platform Worker. The human review follows those
references through the platform before publication. A future cross-service
attestation can strengthen this without replacing the atomic D1 invariant.

## Consequences

- Publication cannot bypass the evidence minimum through another API surface.
- Detailed TypeScript checks are stricter than the SQL safety floor and keep
  seeded published content from drifting in CI.
- The project migration must run after EmDash creates `ec_articles` on a new DB.
- A future EmDash abortable before-publish hook may improve editor-facing error
  detail, but D1 remains the final atomic invariant.
