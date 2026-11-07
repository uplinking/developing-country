# ADR 0005: Compute Source freshness and refresh through review PRs

- Status: accepted
- Date: 2026-08-26

## Context

Agents need to know which evidence needs re-verification, and safe deterministic
adapters should run without an administrator remembering every cadence. A date
alone does not express policy, while treating “recent” as “valid” would overstate
what the platform knows. Direct scheduled publication would also let an upstream
schema change silently replace reviewed evidence.

## Decision

`scripts/data-sources.json` owns Source verification dates, refresh kind,
per-Source threshold overrides, and explicit scheduling opt-in. The pure domain
model in `src/shared/freshness.ts` computes `fresh`, `due`, `overdue`, `live`, or
`invalid` using one assessed date. Year and month precision use the end of that
period so imprecise records are not declared due prematurely. Dataset catalog
entries aggregate the worst required Source state and expose the full states to
agents. Freshness is review urgency only; completeness, provenance, and Dataset
Versions remain separate contracts.

A weekly GitHub workflow selects only due, scheduled, automated Sources. Each
Source runs in an independent matrix job from trusted `main`, derives immutable
Dataset Versions, runs the complete repository check, and force-updates a stable
bot branch and review PR. It has no Cloudflare credentials or deployment step.
Curated, live, expensive, and credentialed Sources are not scheduled by default.

## Consequences

- The CLI, MCP catalog, and scheduler share one computation.
- Adapter or validation failures leave `main` and production unchanged.
- Reviewers can inspect schema, count, provenance, and checksum changes before
  merging a new Dataset Version.
- Due curated evidence remains visible to agents but requires deliberate review.
- GitHub Actions consumes modest weekly minutes only when a Source is due.
