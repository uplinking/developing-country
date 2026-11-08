// MCP App entry (mcp-app.html). AppMcp is a static import so the host frame
// downloads it alongside the entry, and the host handshake (useApp) starts as
// soon as React mounts. The map, data panel and charts stay lazy.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import AppMcp from './AppMcp'

window.__DEVELOPING_COUNTRY_MCP__ = true

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppMcp />
  </StrictMode>,
)
