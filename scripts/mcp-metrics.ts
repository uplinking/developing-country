// Print per-tool MCP metrics from Analytics Engine (scripts/mcp-metrics.sql).
//
//   CLOUDFLARE_API_TOKEN=… bun scripts/mcp-metrics.ts
//
// The token needs the "Account Analytics: Read" permission. The account id
// defaults to the production account and can be overridden with
// CLOUDFLARE_ACCOUNT_ID.

const PRODUCTION_ACCOUNT_ID = 'b9eea9b90f5d9829e1b5a3fa4cb61570'

const token = process.env.CLOUDFLARE_API_TOKEN
if (!token) {
  console.error('Set CLOUDFLARE_API_TOKEN to a token with Account Analytics: Read.')
  process.exit(1)
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID || PRODUCTION_ACCOUNT_ID
const sql = await Bun.file(new URL('./mcp-metrics.sql', import.meta.url)).text()

const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: sql,
})
const text = await response.text()
if (!response.ok) {
  console.error(`Analytics Engine query failed (${response.status}): ${text}`)
  process.exit(1)
}
console.log(text.trim() || 'No tool calls recorded yet.')
