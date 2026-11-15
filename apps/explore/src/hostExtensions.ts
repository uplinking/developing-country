// Optional host extensions, feature-detected — never by host name.
//
// The app talks to every host through the MCP Apps bridge (`App` from
// @modelcontextprotocol/ext-apps). ChatGPT also exposes `window.openai`, whose
// methods are documented as compatibility aliases and ChatGPT extensions. We
// use one only as a fallback, when the standard call is missing or refused, so
// hosts that implement the standard behave exactly as before.

import type { App as McpApp, McpUiDisplayMode } from '@modelcontextprotocol/ext-apps'

interface OpenAiExtensions {
  /** Height cap for inline frames, in pixels. */
  maxHeight?: number
  requestDisplayMode?: (args: { mode: McpUiDisplayMode }) => Promise<{ mode: McpUiDisplayMode }>
  openExternal?: (args: { href: string }) => void
}

declare global {
  interface Window {
    openai?: OpenAiExtensions
  }
}

function extensions(): OpenAiExtensions | undefined {
  try {
    return window.openai
  } catch {
    return undefined
  }
}

/** A positive inline height cap the host publishes outside the MCP host context. */
export function extensionMaxHeight(): number | undefined {
  const value = extensions()?.maxHeight
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

/** True when some bridge can switch this frame to fullscreen. */
export function canRequestFullscreen(app: McpApp | null): boolean {
  if (app?.getHostContext()?.availableDisplayModes?.includes('fullscreen')) return true
  return extensions()?.requestDisplayMode !== undefined
}

/** Ask for a display mode; resolves to the mode the host actually granted. */
export async function requestDisplayMode(app: McpApp | null, mode: McpUiDisplayMode): Promise<McpUiDisplayMode | undefined> {
  if (app) {
    try {
      return (await app.requestDisplayMode({ mode })).mode
    } catch {
      // Fall through to the extension, if the host has one.
    }
  }
  const fallback = extensions()?.requestDisplayMode
  if (!fallback) return undefined
  try {
    return (await fallback({ mode })).mode
  } catch {
    return undefined
  }
}

/** Open a URL outside the frame through whichever bridge accepts it. */
export async function openExternalLink(app: McpApp | null, url: string): Promise<void> {
  if (app) {
    try {
      const result = await app.openLink({ url })
      if (!result.isError) return
    } catch {
      // Fall through to the extension, if the host has one.
    }
  }
  try {
    extensions()?.openExternal?.({ href: url })
  } catch {
    /* the host refused; nothing else to try inside a sandbox */
  }
}
