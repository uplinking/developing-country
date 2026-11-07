// MCP hosts may cache UI resources by URI across conversations. Bump this when
// the embedded app changes so cached HTML cannot reference retired Vite assets.
export const MCP_APP_VERSION = '0.11.0'
export const MCP_UI_RESOURCE_URI = `ui://developing-country/explorer/v${MCP_APP_VERSION}`
// Earlier explorer URIs a host may still hold from an older conversation. They
// resolve to the CURRENT html, so no cached page can point at retired assets.
export const PREVIOUS_MCP_UI_RESOURCE_URIS: readonly string[] = [
  'ui://developing-country/explorer/v0.10.0',
  'ui://developing-country/explorer/v0.9.0',
  'ui://developing-country/explorer/v0.8.0',
  'ui://developing-country/explorer/v0.7.0',
]
