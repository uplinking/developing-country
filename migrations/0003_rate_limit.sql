-- Better Auth rate-limit storage table (rateLimit: { storage: 'database' }).
-- The default in-memory limiter does not work on Cloudflare Workers — counters
-- must persist in D1 so they accumulate across isolates. Schema matches Better
-- Auth 1.6's rateLimit model (fields: key unique, count, lastRequest bigint).
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" integer NOT NULL
);
