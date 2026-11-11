// MCP server at /mcp — streamable-HTTP JSON-RPC 2.0.
//
// Hand-rolled (no SDK). Request/response JSON; live map staging is a Durable
// Object side-channel, not an 11th tool. Handles initialize, ping, tools/list,
// tools/call, resources/*. Notifications → 202; GET → 405. Tools call the SAME
// service.ts functions as the REST API — a tool per intent (manifesto §5).
//
// Protocol version: advertises "2025-06-18"; also accepts older clients.

import type { Env, Identity } from './types'
import { authenticateMcp } from './auth'
import {
  ApiError,
  addProspect,
  analyze,
  catalog,
  coverage,
  listProspects,
  ontology,
  query,
  searchPlaces,
  updateProspect,
  viewEvidence,
} from './service'
import { AGENT_PREVIEW_ROWS } from './resultPreview'
import { toolResultEnvelope } from './mcpEnvelope'
import { loadMcpAppHtml } from './mcpLoader'
import { AGGREGATE_LIMITS } from './queryAggregate'
import { PRESENTATION_MAX_ROWS, SELECT_MAX_ROWS } from './queryData'
import { getEntity, ONTOLOGY } from './ontology'
import { bboxGeometrySource, queryErrorBody } from './querySpatial'
import queryDataSchema from './fixtures/query-spatial.schema.json' with { type: 'json' }
import { coerceStructuredArgs, flattenOperatorSchema } from './mcpSchema'
import {
  analyzeNext,
  datasetCard,
  loadDatasetIndex,
  searchDatasets,
  selectNext,
  suggestedPresentation,
  selectRepair,
  slimCatalog,
} from './discovery'
import { extractStage, persistAndFanout } from './stageFanout'
import type { JsonFc } from '../shared/stage'
import type { JsonObject, JsonPrimitive, JsonValue } from '../shared/json'
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  jsonObjectFromSerializable,
} from '../shared/json'
import {
  UI_EXTENSION_ID,
  UI_RESOURCE_MIME,
  UI_RESOURCE_URI,
  UI_TOOL_META,
  UI_TOOLS,
  clientOffersUi,
  newSessionId,
  requestOffersUi,
  sessionOffersUi,
  stashSession,
  uiResourceMeta,
} from './mcpUi'
import { missFromBody, writeMiss, writeSearchZero, writeToolCall } from './analytics'
import { toolDescriptorMeta, toolPresentationFields } from './mcpToolMeta'
import { MCP_APP_VERSION, PREVIOUS_MCP_UI_RESOURCE_URIS } from '../shared/mcpApp'
import { SUPPORTED_COUNTRY_CODES } from '@developing-country/countries'
import { PUBLIC_DATA_THEMES } from '@developing-country/datasets'
import { countryFromJson } from './country'
import {
  JsonBodyTooLargeError,
  MAX_JSON_BODY_BYTES,
  readJsonBodyLimited,
} from './requestBody'

const PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])

export const MAX_MCP_BATCH_ITEMS = 16

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
}

// ---- Tool registry ----------------------------------------------------------

interface ToolDef {
  name: string
  batchSafe: boolean
  description: string
  inputSchema: JsonObject
  handler: (env: Env, id: Identity, args: JsonObject) => Promise<object>
}

const numberProp = (desc: string) => ({ type: 'number', description: desc })
const stringProp = (desc: string) => ({ type: 'string', description: desc })
const countryProp = {
  type: 'string',
  enum: [...SUPPORTED_COUNTRY_CODES],
  description: 'ISO alpha-2 country code. Defaults to LK when omitted; unsupported codes fail closed.',
}

function optionalString(args: JsonObject, key: string): string | undefined {
  const value = args[key]
  return isJsonString(value) ? value : undefined
}

function optionalNumber(args: JsonObject, key: string): number | undefined {
  const value = args[key]
  return isJsonNumber(value) ? value : undefined
}

const TOOLS: ToolDef[] = [
  {
    name: 'analyze_location',
    batchSafe: false,
    description:
      'Use this when the user asks what is at, near or around a place in Sri Lanka (a town, address, listing or map point). Given the place\'s lat/lng (and optional radius_km, default 10), returns a provenance-tagged readout: district demographics (point-in-polygon), nearest expressway + status, nearby planned developments, attractions, waterfalls, trails, cycling routes, parks, and your own prospects. Completeness is first-class: known_absent means the platform holds no geometry for that class (silent zones, MoH clinics, courts); osm_only is not an official register. Gazette 924/12 defines a 100 m silent-zone facility class; those buffers are not published as law. The result is a point readout, not a bounded spatial or indicator-table query. Each run is logged privately to the signed-in account history (`saved.url` map link). For a property listing, source_url and title store the listing with the run.',
    inputSchema: {
      type: 'object',
      properties: {
        country: countryProp,
        lat: numberProp('Latitude (WGS84) of the place being analysed.'),
        lng: numberProp('Longitude (WGS84) of the place being analysed.'),
        radius_km: numberProp('Search radius in km (default 10, max 100).'),
        source_url: stringProp('Optional: the property-listing URL this analysis is for (saved with the run so it shows in the web app).'),
        title: stringProp('Optional: a human label for the point (listing title / place name).'),
      },
      required: ['lat', 'lng'],
    },
    handler: async (env, id, a) => {
      const result = await analyze(env, id, {
        lat: Number(a.lat),
        lng: Number(a.lng),
        country: countryFromJson(a),
        radius_km: a.radius_km !== undefined ? Number(a.radius_km) : undefined,
        source: 'mcp',
        source_url: a.source_url !== undefined ? String(a.source_url) : undefined,
        title: a.title !== undefined ? String(a.title) : undefined,
      })
      const district = result.district_demographics
      return {
        ...result,
        next: analyzeNext(await loadDatasetIndex(env), district ? {
          id: isJsonString(district.id) ? district.id : undefined,
          name: isJsonString(district.name) ? district.name : undefined,
        } : null),
      }
    },
  },
  {
    name: 'search_places',
    batchSafe: false,
    description:
      'Use this to find a named place in Sri Lanka and its coordinates. Searches by name across searchable ontology stores (metro stops and lines, expressways, developments, BOI zones, attractions, waterfalls, trails, cycling, parks) plus your prospects. Does not search the metro catchment, sea-route or administrative-boundary layers. Returns matches with layer, coordinates, and provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        country: countryProp,
        q: stringProp('Case-insensitive substring to search for.'),
        limit: numberProp('Max results (default 25, max 100).'),
      },
      required: ['q'],
    },
    handler: (env, id, a) => searchPlaces(env, id, {
      country: countryFromJson(a),
      q: String(a.q ?? ''),
      limit: a.limit !== undefined ? Number(a.limit) : undefined,
    }),
  },
  {
    name: 'add_prospect',
    batchSafe: false,
    description:
      'Register a property prospect. Provide a listing url (the server fetches og:title/description/image and any lat/lng), and/or explicit title + lat/lng. Private by default. Returns the stored prospect with scraped metadata plus `web_url`, a map link to the prospect (it appears live under "My prospects" in the web app).',
    inputSchema: {
      type: 'object',
      properties: {
        url: stringProp('Listing URL (LankaPropertyWeb, ikman, …). Server scrapes metadata.'),
        title: stringProp('Human title (optional if url provided).'),
        lat: numberProp('Latitude (optional).'),
        lng: numberProp('Longitude (optional).'),
        notes: stringProp('Free-form notes.'),
        verdict: stringProp("Your call, e.g. 'buy' | 'watch' | 'pass'."),
        visibility: { type: 'string', enum: ['private', 'link', 'public'], description: 'Default private.' },
      },
    },
    handler: (env, id, a) =>
      addProspect(env, id, {
        url: optionalString(a, 'url'),
        title: optionalString(a, 'title'),
        lat: optionalNumber(a, 'lat'),
        lng: optionalNumber(a, 'lng'),
        notes: optionalString(a, 'notes'),
        verdict: optionalString(a, 'verdict'),
        visibility: optionalString(a, 'visibility'),
      }),
  },
  {
    name: 'list_prospects',
    batchSafe: true,
    description: 'List all prospects owned by the authenticated user, newest first.',
    inputSchema: { type: 'object', properties: {} },
    handler: (env, id) => listProspects(env, id),
  },
  {
    name: 'update_prospect',
    batchSafe: false,
    description: 'Update a prospect you own: title, notes, verdict, visibility (private|link|public), or coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('Prospect id.'),
        title: stringProp('New title.'),
        notes: stringProp('New notes.'),
        verdict: stringProp('New verdict.'),
        visibility: { type: 'string', enum: ['private', 'link', 'public'] },
        lat: numberProp('New latitude.'),
        lng: numberProp('New longitude.'),
      },
      required: ['id'],
    },
    handler: (env, id, a) =>
      updateProspect(env, id, {
        id: String(a.id ?? ''),
        title: optionalString(a, 'title'),
        notes: optionalString(a, 'notes'),
        verdict: optionalString(a, 'verdict'),
        visibility: optionalString(a, 'visibility'),
        lat: optionalNumber(a, 'lat'),
        lng: optionalNumber(a, 'lng'),
      }),
  },
  {
    name: 'query_data',
    batchSafe: false,
    description:
      'Use this to read statistics, rankings, trends or map features from a platform dataset, and to save them as a live chart or map. Bounded queries over every registered platform Dataset. op=select reads one Indicator Table: dataset_id plus exact field ids, optional where/order_by/limit (rows capped at 200, or 5000 when saved with a presentation), or aggregate it with group_by (dimension fields) + aggregates [{fn: sum|mean|min|max|count, field, as}] instead of fields (sum only on fields the table declares summable). Field ids must match the table exactly; get_layer_catalog {dataset_id} lists them with filterable values and ready-to-run preset calls. ' +
      'Spatial ops (bbox, nearest, point_in_polygon, overlay, gap, choropleth_join, isochrone) take an ontology entity in `entities`; bbox with include_geometry (+ where property filters) returns any GeoJSON entity\'s own geometry, e.g. polygons, for a saved map; large shapes are not inlined in the text (geometry_omitted, geometry_ref names the asset and selection) while every feature row is. ' +
      'Without presentation the result is a preview the MCP App tables and charts inline; add presentation to persist a live, citable view_url (requires a signed-in verified account). Chart: family, dimension, measure, optional series and highlight. ' +
      'Map: optional camera, annotations [{id, coordinates:[lng,lat], text}], and layers merged onto the result layers by id (entity ids for spatial ops; the dataset_id for a select) with label, style {geometry fill|line|circle, color token or #hex, colorBy {field, scale sequential|diverging|threshold|categorical, breaks, colors, labels, classLabels}, radius, radiusBy, labelField}, legend and join. A select becomes a map when every row has numeric lng/lat or its layer has join {tileset:"demographics", sourceLayer: gnd|dsd|district|province, rowKey}. ' +
      'A saved view also returns `publication` {dataView, datasetVersions, sourceManifest}: the exact CMS evidence_bundle entries (developing-country://evidence/{view_id} re-reads it). Every result carries provenance, completeness and a `next` list of ready-to-send follow-up calls.',
    inputSchema: flattenOperatorSchema(queryDataSchema, {
      select: 'rows from one Indicator Table (dataset_id + fields, optional where/order_by/limit)',
      bbox: 'features of one spatial entity inside a [west,south,east,north] box',
      nearest: 'n nearest features of an entity to origin',
      point_in_polygon: 'which polygon of an entity contains origin',
      overlay: 'features of an entity inside an admin unit or polygon',
      gap: 'features of an entity NOT covered by another within threshold_m',
      isochrone: 'walkable area from origin in 5 or 10 minutes',
      choropleth_join: 'per-polygon values of an entity for a choropleth',
    }),
    handler: async (env, id, raw) => {
      const a = coerceStructuredArgs(raw)
      if (a.op !== 'select') return query(env, id, a)
      const index = await loadDatasetIndex(env)
      try {
        const result = await query(env, id, a)
        const body = { ...result, next: selectNext(index, a, result) }
        const presentation = 'view_url' in result ? null : suggestedPresentation(index, a)
        return presentation ? { ...body, suggested_presentation: presentation } : body
      } catch (error) {
        // A rejected select is the moment the model most needs the real field
        // ids; fold repair hints into the typed error body.
        if (error instanceof ApiError && error.status === 400) {
          throw new ApiError(400, JSON.stringify({ ...queryErrorBody(error), ...selectRepair(index, a) }))
        }
        throw error
      }
    },
  },
  {
    name: 'get_layer_catalog',
    batchSafe: true,
    description:
      'Find and understand Sri Lanka datasets. No arguments: a slim index of all Indicator Tables (with themes, publisher, time span, geography) and spatial entities. {q} and/or {theme}/{publisher}: ranked search across titles, descriptions, field names and dimension values (e.g. q:"remittances", q:"Jaffna", theme:"ECON"). {dataset_id}: one dataset card — exact field ids with roles/units, every filterable value, time span, geography join key, caveats, provenance and freshness, ready-to-run preset calls with chart presentations, and ranked related datasets with reasons. {full:true}: the complete provenance catalog (large; same as resource developing-country://catalog). Every response has a `next` list of suggested calls.',
    inputSchema: {
      type: 'object',
      properties: {
        country: countryProp,
        q: stringProp('Search words, plain language is fine ("school dropouts", "power cuts"). Matches titles, publishers, themes, field names and dimension values such as district names, plus the same synonyms as the /data page; matched_on lists "synonym" when one produced the match.'),
        theme: { type: 'string', enum: PUBLIC_DATA_THEMES.map((t) => t.id), description: 'EU data-theme code filter (ECON economy, SOCI population and society, REGI regions, TRAN transport, …).' },
        publisher: stringProp('Publisher name or id filter, e.g. "Central Bank" or "census".'),
        dataset_id: stringProp('Exact dataset id (or spatial entity id) to open as a full card.'),
        limit: numberProp('Max search results (default 12, max 50).'),
        full: { type: 'boolean', description: 'Return the full provenance catalog instead of the slim index.' },
      },
    },
    handler: async (env, _id, args) => {
      const full = await catalog(countryFromJson(args), env)
      if (args.full === true) return full
      const index = await loadDatasetIndex(env)
      const datasetId = optionalString(args, 'dataset_id')
      if (datasetId) {
        const card = datasetCard(full, index, datasetId)
        if (card) return card
        throw new ApiError(404, JSON.stringify({ error: 'unknown_dataset', dataset_id: datasetId, ...selectRepair(index, { dataset_id: datasetId }) }))
      }
      const q = optionalString(args, 'q')
      const theme = optionalString(args, 'theme')
      const publisher = optionalString(args, 'publisher')
      if ((q || theme || publisher) && index) {
        return { ...searchDatasets(full, index, { q, theme, publisher, limit: optionalNumber(args, 'limit') }), country: full.country }
      }
      return slimCatalog(full, index)
    },
  },
]

// ---- JSON-RPC plumbing ------------------------------------------------------

interface RpcRequest {
  jsonrpc: string
  id?: string | number | null
  method?: string
  params?: JsonObject
}

export function mcpToolBatchRejection(rpc: RpcRequest): string | null {
  if (rpc.method === 'ping') return null
  if (rpc.method !== 'tools/call') return `method ${rpc.method ?? '(missing)'} cannot be called in a JSON-RPC batch`
  const toolName = rpc.params && isJsonString(rpc.params.name) ? rpc.params.name : undefined
  const canonicalName = toolName === 'query_spatial' ? 'query_data' : toolName
  const tool = canonicalName ? TOOLS.find((candidate) => candidate.name === canonicalName) : undefined
  if (!tool) return `unknown tool ${toolName ?? '(missing)'} cannot be called in a JSON-RPC batch`
  return tool.batchSafe ? null : `tool ${toolName} cannot be called in a JSON-RPC batch`
}

export function mcpBatchLengthRejection(itemCount: number): string | null {
  return itemCount > MAX_MCP_BATCH_ITEMS
    ? `JSON-RPC batch exceeds ${MAX_MCP_BATCH_ITEMS} items`
    : null
}

function rpcResult<T extends object | JsonPrimitive>(id: string | number | null, result: T) {
  return { jsonrpc: '2.0', id, result }
}
function rpcError(id: string | number | null, code: number, message: string, data?: JsonValue) {
  const error: JsonObject = { code, message }
  if (data !== undefined) error.data = data
  return { jsonrpc: '2.0', id, error }
}

function jsonResponse<T extends object | JsonPrimitive>(
  data: T,
  status = 200,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })
}

export async function toolListPayload(params: JsonObject, sessionId: string | null) {
  const ui = (await sessionOffersUi(sessionId)) || requestOffersUi(params)
  return {
    tools: TOOLS.map((t) => {
      const base = { name: t.name, description: t.description, inputSchema: t.inputSchema, ...toolPresentationFields(t.name) }
      const meta = toolDescriptorMeta(t.name, ui && UI_TOOLS.has(t.name) ? UI_TOOL_META.ui.resourceUri : null)
      return meta ? { ...base, _meta: meta } : base
    }),
  }
}

function geometryFromResult(value: JsonValue | undefined): JsonFc | undefined {
  if (!isJsonObject(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    return undefined
  }
  // SAFETY: Tool results originate from this platform's services, whose geometry field uses the shared JsonFc contract.
  return value as JsonFc
}

function hullFromResult(
  value: JsonValue | undefined,
): { type: 'Polygon'; coordinates: number[][][] } | undefined {
  if (!isJsonObject(value) || value.type !== 'Polygon' || !Array.isArray(value.coordinates)) {
    return undefined
  }
  // SAFETY: Isochrone hulls are constructed by querySpatial from numeric walk-graph coordinates.
  return value as { type: 'Polygon'; coordinates: number[][][] }
}

async function dispatch(
  rpc: RpcRequest,
  env: Env,
  identity: Identity,
  ctx: ExecutionContext | undefined,
  sessionId: string | null,
): Promise<{ body: object; sessionId?: string }> {
  const id = rpc.id ?? null
  const method = rpc.method
  const params = rpc.params ?? {}

  switch (method) {
    case 'initialize': {
      const requested = String(params.protocolVersion ?? PROTOCOL_VERSION)
      const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_VERSION
      const ui = clientOffersUi(params.capabilities)
      const sid = newSessionId()
      await stashSession(sid, ui)
      return {
        sessionId: sid,
        body: rpcResult(id, {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
            extensions: {
              [UI_EXTENSION_ID]: { mimeTypes: [UI_RESOURCE_MIME] },
            },
          },
          serverInfo: { name: 'developing-country.org', title: 'Developing Country', version: MCP_APP_VERSION },
          instructions:
            'developing-country.org — Sri Lanka evidence platform: 100+ official Indicator Tables (census, CBSL, Treasury, DCS, World Bank) plus spatial layers. ' +
            'Research loop: (1) get_layer_catalog {q} or {theme} to find datasets; (2) get_layer_catalog {dataset_id} for exact field ids, filterable values, presets and related datasets; ' +
            '(3) query_data {op:"select"} — start from a preset call; (4) follow the `next` list on every result (narrow, chart, related, map). ' +
            'Field and dataset ids are exact; get_layer_catalog lists them. analyze_location returns a point composite; its `next` hands off to district tables. ' +
            'Spatial query_data ops cover overlay/gap/isochrone. Cite source + vintage from each result. Completeness is first-class: ' +
            'known_absent means the platform holds no geometry for that class (e.g. silent-zone polygons). ' +
            'The 1996 Noise Control Regulations define a 100 m facility class (gazette 924/12); ' +
            'we do not ship those buffers as law. Hosts that negotiated io.modelcontextprotocol/ui ' +
            'render analyze_location and query_data inline in one app (map, tables, charts; the dataset browser opens inside it); query_data.presentation can persist the result as a live map or chart, and its view_url is safe to embed in an article. A saved view also returns `publication` (dataView, datasetVersions, sourceManifest) for the CMS evidence_bundle; developing-country://evidence/{view_id} re-reads it. The JSON body ' +
            'is still the complete result. A signed-in tab of the same account still stages as fallback.',
        }),
      }
    }
    case 'resources/list':
      return { body: rpcResult(id, { resources: listMcpResources() }) }
    case 'resources/templates/list':
      return {
        body: rpcResult(id, {
          resourceTemplates: [
            {
              uriTemplate: 'developing-country://entity/{id}',
              name: 'Entity type',
              description: 'One ontology EntityType by id (gnd, metro_stop, silent_zone, …).',
              mimeType: 'application/json',
            },
            {
              uriTemplate: 'developing-country://evidence/{view_id}',
              name: 'Data View publication evidence',
              description:
                'For a saved view_…: {dataView, datasetVersions, sourceManifest} exactly as the CMS evidence_bundle and source_manifest require. Merge across views; de-duplicate by versionId and sourceId.',
              mimeType: 'application/json',
            },
          ],
        }),
      }
    case 'resources/read': {
      const uri = String(params.uri ?? '')
      const contents = await readMcpResource(uri, env)
      if (!contents) return { body: rpcError(id, -32002, `resource not found: ${uri}`) }
      return { body: rpcResult(id, { contents }) }
    }
    case 'ping':
      return { body: rpcResult(id, {}) }
    case 'tools/list':
      return { body: rpcResult(id, await toolListPayload(params, sessionId)) }
    case 'tools/call': {
      const requestedName = String(params.name ?? '')
      const name = requestedName === 'query_spatial' ? 'query_data' : requestedName
      const args = isJsonObject(params.arguments) ? params.arguments : {}
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) return { body: rpcError(id, -32602, `unknown tool: ${name}`) }
      const t0 = Date.now()
      try {
        const result = await tool.handler(env, identity, args)
        const rec = jsonObjectFromSerializable(result)
        const geometry = geometryFromResult(rec?.geometry)
        const hull = hullFromResult(rec?.hull)
        const rest: JsonObject = { ...(rec ?? {}) }
        delete rest.geometry
        const uiSession = (await sessionOffersUi(sessionId)) || requestOffersUi(params)
        if (identity.email && ctx && rec && !uiSession) {
          ctx.waitUntil(
            persistAndFanout(env, {
              email: identity.email,
              tool: name,
              events: extractStage(rest),
              geometry,
              hull,
            }),
          )
        }
        const recBody = rec ?? {}
        // Bounded text + structuredContent: oversized geometry is described in
        // the text and handed to the widget by reference (mcpEnvelope.ts).
        const envelope = toolResultEnvelope(name, args, recBody, {
          origin: zoneOrigin(env),
          geometrySource: name === 'query_data' && args.op === 'bbox' && args.include_geometry === true
            ? bboxGeometrySource(args)
            : null,
        })
        const structured = envelope.structuredContent
        writeToolCall(env, {
          tool: name,
          op: isJsonString(recBody.op) ? recBody.op : undefined,
          entities: Array.isArray(recBody.entities) ? recBody.entities.map(String) : undefined,
          ms: Date.now() - t0,
          count: isJsonNumber(recBody.count) ? recBody.count : undefined,
          truncated: recBody.truncated === true || structured?.geometry_omitted === 'size_limit',
        })
        if (name === 'search_places' && Number(recBody.count) === 0) {
          writeSearchZero(env, String(args.q ?? ''))
        }
        return { body: rpcResult(id, envelope) }
      } catch (e) {
        const body =
          e instanceof ApiError
            ? queryErrorBody(e)
            : { error: e instanceof Error ? e.message : String(e) || 'tool error' }
        const miss = missFromBody(body)
        if (miss) writeMiss(env, miss)
        writeToolCall(env, { tool: name, op: String(body.op ?? args.op ?? ''), ms: Date.now() - t0, count: 0 })
        return {
          body: rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
            structuredContent: body,
            isError: true,
          }),
        }
      }
    }
    default:
      return { body: rpcError(id, -32601, `method not found: ${method}`) }
  }
}

function listMcpResources() {
  const staticResources = [
    {
      uri: UI_RESOURCE_URI,
      name: 'developing-country.org',
      description: 'Interactive map and chart view for analyze_location and query_data results.',
      mimeType: UI_RESOURCE_MIME,
    },
    {
      uri: 'developing-country://ontology',
      name: 'Ontology',
      description: 'Full entity/operator graph: completeness, related_ids, storage, provenance.',
      mimeType: 'application/json',
    },
    {
      uri: 'developing-country://catalog',
      name: 'Layer catalog',
      description: 'Complete layer projection including metro, catchment, BOI, sea-routes, completeness.',
      mimeType: 'application/json',
    },
    {
      uri: 'developing-country://coverage',
      name: 'Coverage ledger',
      description: 'Official vs OSM vs missing. Silent zones are statute_only.',
      mimeType: 'application/json',
    },
    {
      uri: 'developing-country://operators',
      name: 'Operators',
      description: 'Closed query_data operator list (auth, cost, applies_to).',
      mimeType: 'application/json',
    },
  ]
  const entities = ONTOLOGY.entities.map((e) => ({
    uri: `developing-country://entity/${e.id}`,
    name: e.title,
    description: e.description,
    mimeType: 'application/json',
  }))
  return [...staticResources, ...entities]
}

/** Runtime limits and the aggregation/presentation grammar for op=select. */
const SELECT_OPERATOR_EXTENSIONS = {
  limits: {
    max_rows: SELECT_MAX_ROWS,
    max_rows_with_presentation: PRESENTATION_MAX_ROWS,
    snapshot_max_bytes: 8 * 1024 * 1024,
    agent_preview_rows_after_save: AGENT_PREVIEW_ROWS,
  },
  aggregation: {
    shape: '{ group_by?: [dimension field], aggregates: [{ fn, field?, as }] } replaces fields',
    functions: ['sum', 'mean', 'min', 'max', 'count'],
    max_group_by: AGGREGATE_LIMITS.maxGroupBy,
    max_aggregates: AGGREGATE_LIMITS.maxAggregates,
    rules: [
      'where filters rows before grouping; order_by may name group_by fields or aggregate outputs',
      'sum requires a field the table declares aggregation: sum; mean/min/max need a numeric field',
      'count without field counts rows; with field counts non-null values',
      'groups are ordered by order_by, then group_by ascending; nulls last; values rounded to 12 significant digits',
    ],
  },
  presentation: {
    chart: 'any select result; highlight values must be dimension values in the result',
    map: 'every row has numeric lng and lat (circle layer), or presentation.layers has {id: dataset_id, join: {tileset: "demographics", sourceLayer, rowKey}} with unique row keys',
  },
}

function zoneOrigin(env: Env): string {
  const configured = env.BETTER_AUTH_URL?.trim()
  if (configured) return new URL(configured).origin
  return 'https://explore.developing-country.org'
}

export async function readMcpResource(
  uri: string,
  env: Env,
): Promise<Array<{ uri: string; mimeType: string; text: string; _meta?: ReturnType<typeof uiResourceMeta> }> | null> {
  if (uri === UI_RESOURCE_URI || PREVIOUS_MCP_UI_RESOURCE_URIS.includes(uri)) {
    const html = await loadMcpAppHtml(env, zoneOrigin(env))
    if (!html) return null
    return [
      {
        uri,
        mimeType: UI_RESOURCE_MIME,
        text: html,
        _meta: uiResourceMeta(env),
      },
    ]
  }
  // Resource contents use the requested URI as MCP requires.
  const canonicalUri = uri
  const json = <T extends object>(value: T) => [
    { uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) },
  ]
  if (canonicalUri === 'developing-country://ontology') return json(ontology())
  if (canonicalUri === 'developing-country://catalog') return json(await catalog(undefined, env))
  if (canonicalUri === 'developing-country://coverage') return json(coverage())
  if (canonicalUri === 'developing-country://operators') {
    const heavySpatial = env.ENABLE_HEAVY_SPATIAL === '1'
    return json(ONTOLOGY.operators.map((operator) => ({
      ...operator,
      available: operator.id === 'isochrone' ? heavySpatial : true,
      unavailable_reason: operator.id === 'isochrone' && !heavySpatial
        ? 'disabled on this cost-capped deployment'
        : undefined,
      runtime_methods: operator.id === 'gap'
        ? { centroid_distance: heavySpatial, street_intersect: true }
        : undefined,
      ...(operator.id === 'select' ? SELECT_OPERATOR_EXTENSIONS : {}),
    })))
  }
  const evidenceMatch = /^developing-country:\/\/evidence\/(view_[a-z0-9]+)$/.exec(canonicalUri)
  if (evidenceMatch) {
    const evidence = await viewEvidence(env, evidenceMatch[1]!)
    return evidence ? json(evidence) : null
  }
  const entityMatch = /^developing-country:\/\/entity\/([a-z0-9_]+)$/.exec(canonicalUri)
  if (entityMatch) {
    const e = getEntity(entityMatch[1])
    if (!e) return null
    return json(e)
  }
  return null
}

function parseRpcRequest(value: JsonValue): RpcRequest | null {
  if (!isJsonObject(value)) return null
  const jsonrpc = isJsonString(value.jsonrpc) ? value.jsonrpc : ''
  const method = isJsonString(value.method) ? value.method : undefined
  const params = isJsonObject(value.params) ? value.params : undefined
  const rawId = value.id
  const id =
    rawId === null || isJsonString(rawId) || isJsonNumber(rawId) ? rawId : undefined
  return { jsonrpc, id, method, params }
}

function errorDetails<T extends object>(body: T): { code: number; message: string } | null {
  const record = jsonObjectFromSerializable(body)
  if (!record || !isJsonObject(record.error)) return null
  const code = record.error.code
  const message = record.error.message
  return isJsonNumber(code) && isJsonString(message) ? { code, message } : null
}

export async function handleMcp(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method === 'GET') {
    // No SSE stream in stateless mode.
    console.log(
      JSON.stringify({ op: 'mcp', step: 'GET-405', ua: request.headers.get('user-agent') ?? '' }),
    )
    return new Response('Method Not Allowed — POST JSON-RPC to /mcp', { status: 405, headers: CORS })
  }
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS })

  const identity = await authenticateMcp(request, env)
  if (!identity) {
    // Per the MCP auth spec, point the client at the protected-resource
    // metadata so it can discover the Better Auth OAuth server and log in.
    // RFC 9728 §3.1: for a resource whose URI HAS a path, the canonical
    // metadata location inserts that path AFTER the well-known segment —
    // <origin>/.well-known/oauth-protected-resource/app/mcp. Point there,
    // not at the bare-origin variant: a client that follows this URL must get
    // back a document whose `resource` equals the MCP URL it called, and the
    // bare-origin form is only canonical for a server mounted at the root.
    // (The Worker's discovery handler answers every variant identically, so
    // this is about telling the client the RIGHT one.) The resource path comes
    // from BETTER_AUTH_URL, which carries the deployment's /app prefix —
    // `request.url` here has already been stripped of it by index.ts.
    const configured = env.BETTER_AUTH_URL?.trim()
    const appBase = configured ? new URL(configured) : new URL(request.url)
    const resourcePath = `${appBase.pathname.replace(/\/+$/, '')}/mcp`
    const resourceMeta = `${appBase.origin}/.well-known/oauth-protected-resource${resourcePath}`
    console.log(
      JSON.stringify({
        op: 'mcp',
        step: 'unauthenticated',
        ua: request.headers.get('user-agent') ?? '',
        hasBearer: (request.headers.get('authorization') ?? '').startsWith('Bearer '),
        challenge: resourceMeta,
      }),
    )
    return new Response(
      JSON.stringify(rpcError(null, -32001, 'unauthorized — OAuth token required')),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${resourceMeta}"`,
          ...CORS,
        },
      },
    )
  }

  let payload: JsonValue
  try {
    payload = await readJsonBodyLimited(request)
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return jsonResponse(
        rpcError(null, -32000, `request body exceeds ${MAX_JSON_BODY_BYTES} bytes`),
        413,
      )
    }
    return jsonResponse(rpcError(null, -32700, 'parse error'), 400)
  }

  const sessionId = request.headers.get('mcp-session-id')

  // Batch support.
  if (Array.isArray(payload)) {
    const batchLengthRejection = mcpBatchLengthRejection(payload.length)
    if (batchLengthRejection) {
      return jsonResponse(rpcError(null, -32600, batchLengthRejection), 400)
    }
    const responses: object[] = []
    let issued: string | undefined
    for (const item of payload) {
      const rpc = parseRpcRequest(item)
      if (!rpc) continue
      if (rpc.id === undefined || rpc.id === null) continue
      const batchRejection = mcpToolBatchRejection(rpc)
      if (batchRejection) {
        responses.push(rpcError(rpc.id, -32000, batchRejection))
        continue
      }
      const out = await dispatch(rpc, env, identity, ctx, sessionId)
      if (out.sessionId) issued = out.sessionId
      responses.push(out.body)
    }
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS })
    return jsonResponse(responses, 200, issued ? { 'Mcp-Session-Id': issued } : undefined)
  }

  const rpc = parseRpcRequest(payload)
  if (!rpc || rpc.jsonrpc !== '2.0' || !rpc.method) {
    return jsonResponse(rpcError(rpc?.id ?? null, -32600, 'invalid request'), 400)
  }
  // Notification (no id) → 202 Accepted, empty body.
  if (rpc.id === undefined || rpc.id === null) {
    return new Response(null, { status: 202, headers: CORS })
  }

  const out = await dispatch(rpc, env, identity, ctx, sessionId)
  const errored = errorDetails(out.body)
  console.log(
    JSON.stringify({
      op: 'mcp',
      step: rpc.method,
      ua: request.headers.get('user-agent') ?? '',
      accept: request.headers.get('accept') ?? '',
      pv: request.headers.get('mcp-protocol-version') ?? '',
      mode: identity.mode,
      err: errored ? `${errored.code} ${errored.message}` : undefined,
      bytes: JSON.stringify(out.body).length,
    }),
  )
  return jsonResponse(out.body, 200, out.sessionId ? { 'Mcp-Session-Id': out.sessionId } : undefined)
}
