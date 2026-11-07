/// <reference types="@cloudflare/workers-types" />

import type { MapSession } from './session'

export interface Env {
  DATASETS?: R2Bucket
  ASSETS: Fetcher
  TILES: R2Bucket
  VIEWS: R2Bucket
  DB: D1Database
  SESSIONS?: DurableObjectNamespace<MapSession>
  ANALYTICS?: AnalyticsEngineDataset
  // Better Auth core config. SECRET signs sessions/tokens (required in prod);
  // URL is the deployment origin (baseURL for cookies + OAuth redirects).
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  // Stable map/chart links are independent of the OAuth/cookie base URL.
  PUBLIC_VIEW_ORIGIN?: string
  // Path prefix the Worker is mounted under on a custom zone, e.g. "/app"
  // for https://example.org/app. Unset ⇒ root-relative (workers.dev
  // staging, local dev). The fetch handler strips this before internal routing.
  BASE_PATH?: string
  // Social login. Each provider lights up ONLY when both its id + secret are
  // set — email/password works with none of these. Set via `wrangler secret`.
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  // Explicit local-dev opt-in. Only when DEV_AUTH="1" (and no Better Auth
  // session) is the X-Dev-User header trusted. Set in .dev.vars; never in prod.
  DEV_AUTH?: string
  // Legacy PMTiles proxy endpoints are disabled by default. Production clients
  // read the allowlisted archives from the public R2 custom domain instead.
  ENABLE_TILE_COMPAT?: string
  // CPU-heavy spatial operations are opt-in so the Free Workers deployment
  // cannot accidentally exceed its CPU budget.
  ENABLE_HEAVY_SPATIAL?: string
  // Live view authoring quota. VIEW_HOURLY_LIMIT (default 5) applies to every
  // owner; VIEW_EDITOR_EMAILS (comma-separated) and the DEV_AUTH user get
  // VIEW_EDITOR_HOURLY_LIMIT (default 60) for multi-figure articles. Per-owner
  // total view and byte caps are unchanged.
  VIEW_HOURLY_LIMIT?: string
  VIEW_EDITOR_HOURLY_LIMIT?: string
  VIEW_EDITOR_EMAILS?: string
}

export interface Identity {
  // Email is the durable identity key — prospects/issues rows key on it, so the
  // switch from Access to Better Auth needs no data migration.
  email: string
  emailVerified: boolean
  mode: 'user' | 'dev'
}
