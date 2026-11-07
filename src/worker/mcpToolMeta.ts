// Host-neutral presentation for every advertised tool: a human title, the MCP
// tool annotations, and the short status lines a host shows while a tool runs.
//
// Annotations are hints the host acts on (ChatGPT asks before a write; Claude
// groups tools by read/write for permissions), so they must describe the
// WORST case of a tool, not its common case. Unset hints default to the
// riskiest reading (destructive, open-world), which is why every tool states
// all four explicitly.
//
// Kept apart from the tool registry in mcp.ts so the registry stays about
// behaviour and this file stays about how a host should present it.

import type { JsonObject } from '../shared/json'

export interface ToolAnnotations {
  title: string
  /** True only when the tool never creates, changes or deletes anything. */
  readOnlyHint: boolean
  /** True when the tool can overwrite or delete existing data. */
  destructiveHint: boolean
  /** True when repeating the same call has no further effect. */
  idempotentHint: boolean
  /**
   * True when the tool reaches outside the platform (fetches a third-party
   * URL) or can make content visible to people other than the caller.
   */
  openWorldHint: boolean
}

export interface ToolPresentation {
  annotations: ToolAnnotations
  /** Shown while the call runs. Present tense, at most 64 characters. */
  invoking: string
  /** Shown once it returns. Past tense, at most 64 characters. */
  invoked: string
}

export const STATUS_TEXT_MAX = 64

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

export const TOOL_PRESENTATION: ReadonlyMap<string, ToolPresentation> = new Map<string, ToolPresentation>([
  [
    'analyze_location',
    {
      // Reads only platform data, but logs the run to the caller's private
      // history ("Every run is saved"), so it is not read-only.
      annotations: {
        title: 'Analyze a location',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      invoking: 'Reading the evidence around this point…',
      invoked: 'Location analysed',
    },
  ],
  [
    'search_places',
    {
      annotations: { title: 'Search places', ...READ },
      invoking: 'Searching places…',
      invoked: 'Places found',
    },
  ],
  [
    'add_prospect',
    {
      // Fetches the listing URL the caller supplies, and may be saved public.
      annotations: {
        title: 'Save a property prospect',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      invoking: 'Saving the prospect…',
      invoked: 'Prospect saved',
    },
  ],
  [
    'list_prospects',
    {
      annotations: { title: 'List my prospects', ...READ },
      invoking: 'Loading your prospects…',
      invoked: 'Prospects loaded',
    },
  ],
  [
    'update_prospect',
    {
      // Overwrites fields and can change visibility to public.
      annotations: {
        title: 'Update a prospect',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      invoking: 'Updating the prospect…',
      invoked: 'Prospect updated',
    },
  ],
  [
    'report_issue',
    {
      // Civic issues are public on the platform map.
      annotations: {
        title: 'Report a civic issue',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      invoking: 'Filing the report…',
      invoked: 'Issue reported',
    },
  ],
  [
    'list_issues',
    {
      annotations: { title: 'List civic issues', ...READ },
      invoking: 'Loading civic issues…',
      invoked: 'Civic issues loaded',
    },
  ],
  [
    'contribute',
    {
      // Contributions appear publicly on the issue.
      annotations: {
        title: 'Contribute to an issue',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      invoking: 'Posting your contribution…',
      invoked: 'Contribution posted',
    },
  ],
  [
    'query_data',
    {
      // Read-only without `presentation`; with it, the call saves a Data View
      // anyone with its link can open. Annotations are per tool, so the
      // saving path decides them.
      annotations: {
        title: 'Query data',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      invoking: 'Querying the evidence…',
      invoked: 'Results ready',
    },
  ],
  [
    'get_layer_catalog',
    {
      annotations: { title: 'Find datasets', ...READ },
      invoking: 'Searching the catalogue…',
      invoked: 'Catalogue ready',
    },
  ],
])

/**
 * Descriptor `_meta` for one tool. `ui.resourceUri` (MCP Apps standard) only
 * when the client negotiated the UI extension and the tool paints the app.
 * The status lines use ChatGPT's descriptor keys; they are inert metadata
 * every other host ignores, so they are not gated.
 */
export function toolDescriptorMeta(name: string, uiResourceUri: string | null): JsonObject | undefined {
  const presentation = TOOL_PRESENTATION.get(name)
  const meta: JsonObject = {}
  if (uiResourceUri) meta.ui = { resourceUri: uiResourceUri }
  if (presentation) {
    meta['openai/toolInvocation/invoking'] = presentation.invoking
    meta['openai/toolInvocation/invoked'] = presentation.invoked
  }
  return Object.keys(meta).length > 0 ? meta : undefined
}

/**
 * The `annotations` and `title` a tools/list entry carries. Unknown tools get
 * nothing, so a tool added without a row here is caught by the test rather
 * than shipped with the riskiest defaults silently.
 */
export function toolPresentationFields(name: string): JsonObject {
  const presentation = TOOL_PRESENTATION.get(name)
  if (!presentation) return {}
  const { annotations } = presentation
  return {
    title: annotations.title,
    annotations: { ...annotations },
  }
}
