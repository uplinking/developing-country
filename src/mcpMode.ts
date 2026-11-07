/** True when this bundle is booting inside an MCP Apps host iframe. */
export function isMcpApp(): boolean {
  if (window.__DEVELOPING_COUNTRY_MCP__) return true
  if (window.location.origin === 'null') return true
  try {
    return new URLSearchParams(window.location.search).has('mcp')
  } catch {
    return false
  }
}

declare global {
  interface Window {
    __DEVELOPING_COUNTRY_MCP__?: boolean
  }
}
