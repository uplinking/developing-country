import { CANONICAL_EXPLORER_ORIGIN } from './explorer'

/** The connector's MCP server, the address every assistant connects to. */
export const MCP_SERVER_URL = `${CANONICAL_EXPLORER_ORIGIN}/mcp`
/** The name the connector goes by inside each assistant. */
const CONNECTOR_NAME = 'developing-country.org'

/**
 * Buttons that open the connector straight in each assistant.
 *
 * How we show them, following each maker's guidance:
 * - Wording: "Connect to Claude" is the button wording Anthropic's connector docs use for a link
 *   from your own site (claude.com/docs/connectors/building/directory-vs-custom). For ChatGPT we
 *   say "Use in ChatGPT": OpenAI asks that a plugin never imply it is made or endorsed by OpenAI
 *   (developers.openai.com/apps-sdk/app-submission-guidelines), so no "official" or "partner".
 * - Names as plain text, spelled as the makers spell them: Claude, ChatGPT. No Anthropic or
 *   OpenAI logos or brand colours: the buttons wear our own style.
 * - Both get the same weight and the same width, one above the other; neither is the "main" one.
 * - Each opens in a new tab, on the maker's own site, where the person confirms before anything
 *   is added.
 */
export const ASSISTANT_LINKS = [
  {
    label: 'Connect to Claude',
    // Opens Claude's "Add custom connector" dialog with our name and address filled in. Once the
    // directory listing is live, its permanent claude.ai/directory/connectors/<slug> link goes here.
    href: `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(CONNECTOR_NAME)}&connectorUrl=${encodeURIComponent(MCP_SERVER_URL)}`,
  },
  {
    label: 'Use in ChatGPT',
    // ChatGPT's plugin directory. Swap in the listing's own link so it opens the plugin directly.
    href: 'https://chatgpt.com/plugins',
  },
] as const
