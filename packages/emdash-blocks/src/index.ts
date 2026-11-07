import type { PluginDescriptor, ResolvedPlugin } from 'emdash'
import { definePlugin } from 'emdash'
import { z } from 'zod'
import { PUBLICATION_CONTRACT } from './publication-contract'
import { FIGURE_BLOCK_CONFIGS } from './figure-admin'

const publicationContractOutput = z.object({
  version: z.literal(1),
  collection: z.literal('articles'),
}).passthrough()

export { liveViewUrlFromNode } from './live-view'
export * from './figure-blocks'
export { FIGURE_BLOCK_CONFIGS } from './figure-admin'
export { safeFigureViewUrl, safeScrollySteps, safeUnderlayUrls } from './figure-view'
export { safeCmsHref } from './safe-href'
export { PUBLICATION_CONTRACT } from './publication-contract'

export function developingCountryBlocks(): PluginDescriptor {
  return {
    id: 'developing-country-blocks',
    version: '0.1.0',
    entrypoint: '@developing-country/emdash-blocks',
    componentsEntry: '@developing-country/emdash-blocks/astro',
  }
}

export function createPlugin(): ResolvedPlugin {
  return definePlugin({
    id: 'developing-country-blocks',
    version: '0.1.0',
    capabilities: [],
    routes: {
      'publication-requirements': {
        permission: 'content:write',
        input: z.object({}),
        handler: async () => PUBLICATION_CONTRACT,
      },
    },
    mcp: {
      tools: {
        publication_requirements: {
          description: 'Return the exact evidence contract and workflow required to draft a publishable developing-country.org research article.',
          route: 'publication-requirements',
          input: z.object({}),
          output: publicationContractOutput,
          destructive: false,
        },
      },
    },
    admin: {
      portableTextBlocks: [
        {
          type: 'dcHero',
          label: 'Editorial hero',
          category: 'Developing Country',
          icon: 'layout',
          description: 'A page or section introduction with two calls to action.',
          fields: [
            { type: 'text_input', action_id: 'eyebrow', label: 'Eyebrow' },
            { type: 'text_input', action_id: 'headline', label: 'Headline' },
            { type: 'text_input', action_id: 'subheadline', label: 'Summary' },
            { type: 'text_input', action_id: 'primaryLabel', label: 'Primary action label' },
            { type: 'text_input', action_id: 'primaryUrl', label: 'Primary action URL' },
            { type: 'text_input', action_id: 'secondaryLabel', label: 'Secondary action label' },
            { type: 'text_input', action_id: 'secondaryUrl', label: 'Secondary action URL' },
          ],
        },
        {
          type: 'dcStats',
          label: 'Evidence counters',
          category: 'Developing Country',
          icon: 'chart',
          description: 'Three compact facts with a source note.',
          fields: [
            { type: 'text_input', action_id: 'value1', label: 'First value' },
            { type: 'text_input', action_id: 'label1', label: 'First label' },
            { type: 'text_input', action_id: 'value2', label: 'Second value' },
            { type: 'text_input', action_id: 'label2', label: 'Second label' },
            { type: 'text_input', action_id: 'value3', label: 'Third value' },
            { type: 'text_input', action_id: 'label3', label: 'Third label' },
            { type: 'text_input', action_id: 'source', label: 'Source note' },
          ],
        },
        {
          type: 'dcLiveView',
          label: 'Live data view',
          category: 'Developing Country',
          icon: 'chart',
          description: 'Embed a platform map or chart using its canonical live-view URL.',
          fields: [
            { type: 'text_input', action_id: 'view_url', label: 'Live-view URL' },
            { type: 'text_input', action_id: 'title', label: 'Accessible title' },
            { type: 'text_input', action_id: 'caption', label: 'Caption' },
          ],
        },
        ...FIGURE_BLOCK_CONFIGS,
      ],
    },
  })
}

export default createPlugin
