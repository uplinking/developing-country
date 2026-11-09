import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import { isMcpApp } from './mcpMode'
import { applyCrawlHint, crawlHint } from './crawlHints'

const root = document.getElementById('root')!

async function boot() {
  if (isMcpApp()) {
    const { default: AppMcp } = await import('./AppMcp.tsx')
    createRoot(root).render(
      <StrictMode>
        <AppMcp />
      </StrictMode>,
    )
    return
  }
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  applyCrawlHint(crawlHint(window.location.href, basePath))
  const escapedBase = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (window.location.pathname.replace(/\/$/, '') === `${basePath}/brand`) {
    document.body.classList.add('document-scroll')
    document.title = 'Brand studio — Developing Country'
    const { BrandPlayground } = await import('@developing-country/ui/BrandPlayground')
    createRoot(root).render(<StrictMode><BrandPlayground /></StrictMode>)
    return
  }
  const viewMatch = new RegExp(`^${escapedBase}/views/([^/?#]+)/?$`).exec(window.location.pathname)
  if (viewMatch) {
    const { default: LiveViewPage } = await import('./views/LiveViewPage.tsx')
    createRoot(root).render(
      <StrictMode>
        <LiveViewPage id={decodeURIComponent(viewMatch[1])} />
      </StrictMode>,
    )
    return
  }
  const datasetMatch = new RegExp(`^${escapedBase}/datasets/([^/?#]+)/([^/?#]+)/?$`).exec(window.location.pathname)
  if (datasetMatch) {
    document.body.classList.add('document-scroll')
    const { default: DatasetChartPage } = await import('./views/DatasetChartPage.tsx')
    createRoot(root).render(
      <StrictMode>
        <DatasetChartPage
          datasetId={decodeURIComponent(datasetMatch[1])}
          presetId={decodeURIComponent(datasetMatch[2])}
        />
      </StrictMode>,
    )
    return
  }
  const { pendingAuthorization } = await import('./auth/authorization.ts')
  const authorization = pendingAuthorization(window.location.search)
  if (authorization) {
    const { default: ConnectFlow } = await import('./auth/ConnectFlow.tsx')
    createRoot(root).render(
      <StrictMode>
        <ConnectFlow params={authorization} />
      </StrictMode>,
    )
    return
  }
  const { default: App } = await import('./App.tsx')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
