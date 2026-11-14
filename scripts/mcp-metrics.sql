-- Per-tool MCP cost and latency over the last 7 days (Phase 0 of the architecture plan).
-- Written by src/worker/analytics.ts writeToolCall; column positions are fixed there.
--
-- Run: CLOUDFLARE_API_TOKEN=… bun scripts/mcp-metrics.ts   (token needs Account Analytics: Read)
--
-- blob1 tool · blob2 op · blob3 dataset · blob4 'truncated' · blob5 outcome ok|error|miss
-- blob6 OAuth client · blob7 cold|warm
-- double1 wall ms · double2 rows · double3 response bytes · double4 auth ms
-- double5 D1 queries · double6 D1 rows read · double7 D1 rows written
-- double8 R2 Class A · double9 R2 Class B · double10 R2 bytes read
-- double11 asset fetches · double12 asset bytes
--
-- `ms` is wall time, not CPU: a Worker cannot measure its own CPU. For CPU per
-- tool, filter Workers Logs on the `tool` field of the `op: "mcp"` log line and
-- read the invocation's CPU time.
-- Analytics Engine samples at high volume; _sample_interval weights every figure.

SELECT
  blob1 AS tool,
  blob7 AS start,
  blob5 AS outcome,
  SUM(_sample_interval) AS calls,
  quantileWeighted(0.5)(double1, _sample_interval) AS p50_ms,
  quantileWeighted(0.95)(double1, _sample_interval) AS p95_ms,
  quantileWeighted(0.95)(double4, _sample_interval) AS p95_auth_ms,
  quantileWeighted(0.95)(double3, _sample_interval) AS p95_bytes,
  SUM(double6 * _sample_interval) / SUM(_sample_interval) AS avg_d1_rows_read,
  SUM(double9 * _sample_interval) / SUM(_sample_interval) AS avg_r2_class_b,
  SUM(double11 * _sample_interval) / SUM(_sample_interval) AS avg_asset_fetches,
  SUM(double12 * _sample_interval) / SUM(_sample_interval) AS avg_asset_bytes
FROM developing_country_mcp
WHERE index1 = 'tool_call'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY tool, start, outcome
ORDER BY calls DESC
FORMAT TabSeparatedWithNames
