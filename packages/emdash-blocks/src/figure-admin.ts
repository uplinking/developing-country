import type { PortableTextBlockConfig } from 'emdash'

const VIEW_URL_LABEL = 'Data View URL (https://explore.developing-country.org/views/view_…)'
const FORMAT_OPTIONS = [
  { label: 'Number (1,234)', value: 'number' },
  { label: 'Compact (1.2K)', value: 'compact' },
  { label: 'Percent (23%)', value: 'percent' },
]
const AGGREGATE_OPTIONS = [
  { label: 'First matching row', value: 'first' },
  { label: 'Sum', value: 'sum' },
  { label: 'Mean', value: 'mean' },
  { label: 'Minimum', value: 'min' },
  { label: 'Maximum', value: 'max' },
  { label: 'Count of matching rows', value: 'count' },
]

const bindingFields = [
  { type: 'text_input', action_id: 'view_url', label: VIEW_URL_LABEL },
  { type: 'text_input', action_id: 'field', label: 'Row field holding the number' },
  { type: 'text_input', action_id: 'where_field', label: 'Only rows where this field… (optional)' },
  { type: 'text_input', action_id: 'where_value', label: '…equals this value (optional)' },
  { type: 'select', action_id: 'aggregate', label: 'Combine matching rows', options: AGGREGATE_OPTIONS, initial_value: 'first' },
  { type: 'number_input', action_id: 'scale', label: 'Multiply by (e.g. 100 for a share shown as %)' },
] satisfies PortableTextBlockConfig['fields']

/**
 * Admin editors for the interactive article blocks (ADR 0009). Every block
 * stores Data View URLs and intent only; the renderers live in packages/figures.
 */
export const FIGURE_BLOCK_CONFIGS: PortableTextBlockConfig[] = [
  {
    type: 'dcFigure',
    label: 'Figure (map or chart)',
    category: 'Developing Country',
    icon: 'chart',
    description: 'One map or chart drawn inline from a saved Data View, optionally over other map views (underlays). Every URL must also appear in evidence_bundle.dataViews.',
    fields: [
      { type: 'text_input', action_id: 'view_url', label: VIEW_URL_LABEL },
      { type: 'text_input', action_id: 'title', label: 'Figure title (defaults to the view title)' },
      { type: 'text_input', action_id: 'caption', label: 'Caption: what the reader should notice', multiline: true },
      { type: 'text_input', action_id: 'underlay_urls', label: 'Map views drawn beneath (comma-separated Data View URLs, lowest first; optional)' },
      {
        type: 'select',
        action_id: 'size',
        label: 'Width',
        options: [
          { label: 'Inline — text column', value: 'inline' },
          { label: 'Wide — breaks out of the column', value: 'wide' },
          { label: 'Full — edge to edge', value: 'full' },
        ],
        initial_value: 'inline',
      },
    ],
  },
  {
    type: 'dcScrolly',
    label: 'Scrolly (sticky figure + steps)',
    category: 'Developing Country',
    icon: 'layout',
    description: 'A sticky map or chart that changes as the reader scrolls. Each step names its view and may move the camera, show only some layers and highlight features. Every step URL must appear in evidence_bundle.dataViews.',
    fields: [
      { type: 'text_input', action_id: 'title', label: 'Section title (optional)' },
      {
        type: 'repeater',
        action_id: 'steps',
        label: 'Steps',
        item_label: 'Step',
        min_items: 1,
        max_items: 24,
        fields: [
          { type: 'text_input', action_id: 'text', label: 'Step text (blank line = new paragraph)', multiline: true },
          { type: 'text_input', action_id: 'view_url', label: VIEW_URL_LABEL },
          { type: 'number_input', action_id: 'center_lng', label: 'Camera longitude (optional)', min: -180, max: 180 },
          { type: 'number_input', action_id: 'center_lat', label: 'Camera latitude (optional)', min: -90, max: 90 },
          { type: 'number_input', action_id: 'zoom', label: 'Camera zoom (optional, 0–24)', min: 0, max: 24 },
          { type: 'text_input', action_id: 'show', label: 'Show only these layer ids (comma-separated, optional)' },
          { type: 'text_input', action_id: 'highlight', label: 'Highlight these row ids (comma-separated, optional)' },
          { type: 'text_input', action_id: 'underlay_urls', label: 'Map views drawn beneath this step (comma-separated Data View URLs, lowest first; optional)' },
        ],
      },
    ],
  },
  {
    type: 'dcStat',
    label: 'Bound number',
    category: 'Developing Country',
    icon: 'chart',
    description: 'A big number read from a Data View row, never typed by hand. Set a guess id to compare it with the reader’s guess.',
    fields: [
      { type: 'text_input', action_id: 'label', label: 'Label under the number' },
      ...bindingFields,
      { type: 'select', action_id: 'format', label: 'Format', options: FORMAT_OPTIONS, initial_value: 'number' },
      { type: 'text_input', action_id: 'unit', label: 'Unit after the number (optional)' },
      { type: 'text_input', action_id: 'note', label: 'Note (optional)', multiline: true },
      { type: 'text_input', action_id: 'guess_id', label: 'Reveal the guess with this id (optional)' },
    ],
  },
  {
    type: 'dcGuess',
    label: 'Guess before you scroll',
    category: 'Developing Country',
    icon: 'chart',
    description: 'The reader commits to a guess on a slider; the answer, bound to a Data View, is revealed as they scroll on. Guesses stay in the reader’s browser.',
    fields: [
      { type: 'text_input', action_id: 'guess_id', label: 'Guess id (unique in the article, e.g. metro-share)' },
      { type: 'text_input', action_id: 'question', label: 'Question', multiline: true },
      { type: 'number_input', action_id: 'min', label: 'Slider minimum' },
      { type: 'number_input', action_id: 'max', label: 'Slider maximum' },
      { type: 'number_input', action_id: 'step', label: 'Slider step (optional)' },
      ...bindingFields,
      { type: 'select', action_id: 'format', label: 'Format', options: FORMAT_OPTIONS, initial_value: 'number' },
      { type: 'text_input', action_id: 'unit', label: 'Unit (optional)' },
      { type: 'text_input', action_id: 'reveal_hint', label: 'Reveal hint, e.g. “We’ll check after the map.” (optional)' },
    ],
  },
  {
    type: 'dcExplorer',
    label: 'Explorer (searchable small multiples)',
    category: 'Developing Country',
    icon: 'layout',
    description: 'One card per row of a Data View, searchable and sortable, with bars scaled to each metric’s maximum.',
    fields: [
      { type: 'text_input', action_id: 'view_url', label: VIEW_URL_LABEL },
      { type: 'text_input', action_id: 'title', label: 'Title (optional)' },
      { type: 'text_input', action_id: 'title_field', label: 'Row field for each card title' },
      { type: 'text_input', action_id: 'subtitle_field', label: 'Row field for each card subtitle (optional)' },
      { type: 'text_input', action_id: 'search_fields', label: 'Searchable fields (comma-separated; defaults to title)' },
      {
        type: 'repeater',
        action_id: 'metrics',
        label: 'Metrics',
        item_label: 'Metric',
        min_items: 1,
        max_items: 6,
        fields: [
          { type: 'text_input', action_id: 'field', label: 'Row field' },
          { type: 'text_input', action_id: 'label', label: 'Label' },
          { type: 'text_input', action_id: 'unit', label: 'Unit (optional)' },
          { type: 'select', action_id: 'format', label: 'Format', options: FORMAT_OPTIONS, initial_value: 'number' },
        ],
      },
      {
        type: 'repeater',
        action_id: 'badges',
        label: 'Badges (one compact line under the bars)',
        item_label: 'Badge',
        max_items: 6,
        fields: [
          { type: 'text_input', action_id: 'field', label: 'Row field' },
          { type: 'text_input', action_id: 'label', label: 'Symbol or short label, e.g. 🏫' },
          { type: 'text_input', action_id: 'unit', label: 'Unit word, e.g. schools (optional)' },
          { type: 'select', action_id: 'format', label: 'Format', options: FORMAT_OPTIONS, initial_value: 'number' },
        ],
      },
      { type: 'text_input', action_id: 'sort_field', label: 'Initial sort field (optional)' },
      {
        type: 'select',
        action_id: 'sort_dir',
        label: 'Initial sort direction',
        options: [{ label: 'Highest first', value: 'desc' }, { label: 'Lowest first', value: 'asc' }],
        initial_value: 'desc',
      },
    ],
  },
]
