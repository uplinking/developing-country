#!/usr/bin/env bun
// House-style lint for analysis articles.
//
//   bun scripts/lint-article.mjs analysis/<slug> [--json]
//
// Reads analysis/<slug>/article.json and recipe.json and checks every piece of
// reader-facing text: title, dek, headings, paragraphs, scroll steps, stat and
// guess labels, explorer labels, captions and chart titles. Errors are patterns
// the voice guide forbids (machine-made tells, bold lead-ins, em dashes,
// colour narration, title-case or colon headings); warnings are judgement
// calls for a human (long sentences, number-heavy sentences, long headlines,
// long slide notes, and more figures than the slide-deck shape allows). Exits 1 on errors.
// Deterministic and read-only, so it can run in CI and before every review.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Phrases the voice guide forbids, grouped by why. Matched case-insensitively on word boundaries. */
export const BANNED = {
  'inflated significance': [
    'pivotal', 'crucial', 'vital', 'landscape', 'testament', 'underscore', 'underscores', 'underscoring',
    'highlights the importance', 'reflects broader', 'plays a role', 'plays a key role', 'transformative',
    'game-changer', 'game changer', 'paramount', 'key role', 'key factor', 'key driver',
  ],
  'stock AI word': [
    'delve', 'delves', 'tapestry', 'intricate', 'nuanced', 'robust', 'leverage', 'leverages', 'foster',
    'fosters', 'fostering', 'showcase', 'showcases', 'showcasing', 'seamless', 'seamlessly', 'holistic',
    'realm', 'myriad', 'embark', 'unlock', 'unlocks', 'harness', 'streamline', 'vibrant', 'bustling',
    'nestled', 'navigate the', 'navigating the',
  ],
  'copula dodge': ['serves as', 'stands as', 'acts as', 'functions as', 'boasts'],
  'formulaic ending': [
    'despite these challenges', 'moving forward', 'looking ahead', 'in conclusion', 'ultimately',
    'only time will tell', 'in summary', 'to sum up',
  ],
  'throat-clearing': [
    'it is important to note', "it's important to note", 'it is worth noting', "it's worth noting",
    'notably', 'interestingly', 'essentially', 'in other words', "let's look at", "here's what we found",
    "here's the thing", 'the takeaway',
  ],
  'vague authority': ['experts say', 'studies show', 'it is widely believed', 'observers note', 'many believe'],
  'data cliché': [
    'the data shows', 'the data reveals', 'the numbers tell', 'paints a picture', 'a closer look reveals',
    'sheds light', 'deep dive', 'tells a story',
  ],
}

const NEGATIVE_PARALLELISM = [
  /\bnot just\b/i,
  /\bnot only\b[^.]*\bbut\b/i,
  /\bisn['’]t\b[^.]{0,80}\.\s+(?:it|they|this)['’]?s?\b/i,
  /\bis not (?:a|an|the|on|in|about)\b[^.]{0,80}\.\s+(?:it|they|this) (?:is|are|was)\b/i,
  /\bit['’]s not about\b/i,
]

const TRAILING_ING = /,\s+(?:highlighting|underscoring|reflecting|showcasing|emphasi[sz]ing|demonstrating|illustrating|signalling|signaling|making it|cementing|solidifying|marking)\b/i

/** "Teal is where you can walk", "shaded by how crowded it is": the legend explains the encoding; prose names places and people. */
const COLOUR_NARRATION = /\b(?:teal|grey|gray|red|blue|green|amber|orange|yellow|purple|pink|dark|light|pale)\s+(?:is|are|shows|show|marks|mark|means|dots?|ones?|areas?|lines?|bars?)\b|\bthe (?:teal|grey|gray|red|blue|green|amber|orange|yellow|purple|pink|darker|lighter|paler)\b|\b(?:is|are) shaded\b|\bshaded by\b|\bthe shaded\b|\bthe (?:bigger|larger|smaller) the dot\b|\bthe highlighted\b|\bcoloured by\b|\bcolored by\b|\bstays? pale\b/i

const EMOJI = /\p{Extended_Pictographic}/u
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'over', 'the', 'to', 'up', 'with', 'per'])

function sentencesOf(text) {
  return text
    .replace(/\*\*|\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"‘'])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function wordCount(text) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

/** Title case: most non-small words after the first start with a capital (proper nouns excused by a high bar). */
function looksTitleCase(text) {
  const words = text.replace(/[^\p{L}\s'’-]/gu, ' ').split(/\s+/).filter(Boolean).slice(1)
  const content = words.filter((word) => !SMALL_WORDS.has(word.toLowerCase()))
  if (content.length < 3) return false
  const capitalised = content.filter((word) => /^\p{Lu}/u.test(word))
  return capitalised.length / content.length >= 0.75
}

/** Every reader-facing string, with a path, a kind and the rules that apply to it. */
function collect(article, recipe) {
  const out = []
  const add = (path, kind, text) => {
    if (typeof text === 'string' && text.trim()) out.push({ path, kind, text: text.trim() })
  }
  const f = article.fields ?? {}
  add('fields.title', 'headline', f.title)
  add('fields.dek', 'dek', f.dek)
  add('fields.research_question', 'prose', f.research_question)
  add('fields.methodology', 'method', f.methodology)
  ;(article.content ?? []).forEach((block, i) => {
    const at = `content[${i}]`
    if (typeof block === 'string') return add(at, 'paragraph', block)
    if (block.h2) return add(`${at}.h2`, 'heading', block.h2)
    if (block.h3) return add(`${at}.h3`, 'heading', block.h3)
    for (const key of ['title']) add(`${at}.${key}`, 'title', block[key])
    for (const key of ['caption', 'note', 'reveal_hint']) add(`${at}.${key}`, 'prose', block[key])
    add(`${at}.question`, 'prose', block.question)
    add(`${at}.label`, 'label', block.label)
    ;(block.steps ?? []).forEach((step, j) => add(`${at}.steps[${j}].text`, 'step', step.text))
    ;(block.metrics ?? []).forEach((metric, j) => add(`${at}.metrics[${j}].label`, 'label', metric.label))
  })
  for (const [key, figure] of Object.entries(recipe?.figures ?? {})) {
    const p = figure.presentation ?? {}
    add(`recipe.${key}.title`, 'chart-title', p.title)
    add(`recipe.${key}.description`, 'prose', p.description)
  }
  return out
}

export function lintArticle(article, recipe) {
  const issues = []
  const issue = (level, item, rule, detail) => issues.push({ level, path: item.path, rule, detail, text: item.text.slice(0, 140) })

  for (const item of collect(article, recipe)) {
    const lower = item.text.toLowerCase()
    for (const [why, phrases] of Object.entries(BANNED)) {
      for (const phrase of phrases) {
        const pattern = new RegExp(`(^|[^\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu')
        if (pattern.test(lower)) issue('error', item, why, `"${phrase}"`)
      }
    }
    for (const pattern of NEGATIVE_PARALLELISM) if (pattern.test(item.text)) issue('error', item, 'negative parallelism', 'state the positive claim directly')
    if (TRAILING_ING.test(item.text)) issue('error', item, 'trailing -ing commentary', 'split into a sentence with a real subject')
    if (/\b(?:is|are|was|isn['’]t|aren['’]t)\s+not\s+(?:a|an|the|just|only|simply)\b|\b(?:isn['’]t|aren['’]t)\s+(?:a|an|the|just|only|simply)\b/i.test(item.text)) issue('warn', item, 'negative framing', 'check for a denied misconception nobody stated; say the positive claim')
    if (/—|\s–\s/.test(item.text)) issue('error', item, 'em dash', 'use a full stop or a comma')
    if (item.kind === 'paragraph' && /^\*\*[^*]+\*\*/.test(item.text)) issue('error', item, 'bold lead-in', 'write the sentence; no labels')

    if (['heading', 'headline', 'title', 'chart-title'].includes(item.kind)) {
      if (looksTitleCase(item.text)) issue('error', item, 'title case', 'use sentence case')
      if (item.kind !== 'chart-title' && /:/.test(item.text)) issue('error', item, 'colon heading', 'one plain statement')
      if (EMOJI.test(item.text)) issue('error', item, 'emoji in heading', 'emoji belong in data labels only')
    }
    if (item.kind === 'headline' && wordCount(item.text) > 10) issue('warn', item, 'long headline', `${wordCount(item.text)} words; aim for under 8`)
    if (item.kind === 'headline' && /\?$/.test(item.text)) issue('warn', item, 'question headline', 'name the subject plainly')
    if (item.kind === 'step' && wordCount(item.text) > 45) issue('warn', item, 'long slide note', `${wordCount(item.text)} words; aim for under 45`)
    if (COLOUR_NARRATION.test(item.text)) issue('error', item, 'colour narration', 'name the thing the colour stands for, not the colour')
    if (item.kind === 'dek' && wordCount(item.text) > 45) issue('warn', item, 'long dek', `${wordCount(item.text)} words`)
    if ((item.text.match(/:/g) ?? []).length > 1) issue('warn', item, 'colons', 'more than one colon')

    if (item.kind === 'method') continue
    for (const sentence of sentencesOf(item.text)) {
      const words = wordCount(sentence)
      if (words > 30) issue('warn', item, 'long sentence', `${words} words: "${sentence.slice(0, 80)}…"`)
      const numbers = sentence.match(/\b\d[\d,.]*\b/g) ?? []
      if (numbers.length > 3) issue('warn', item, 'number-heavy sentence', `${numbers.length} numbers: "${sentence.slice(0, 80)}…"`)
    }
  }

  // The shape of a piece: one slide deck, at most two bound numbers,
  // at most one lookup, and standalone figures or guesses only when nothing
  // else works. More than that reads as a report.
  const blocks = (article.content ?? []).filter((block) => block && typeof block === 'object' && block._type)
  const count = (type) => blocks.filter((block) => block._type === type).length
  const budget = { dcScrolly: 1, dcStat: 2, dcExplorer: 1, dcFigure: 0, dcGuess: 0 }
  for (const [type, max] of Object.entries(budget)) {
    const n = count(type)
    if (n > max) issues.push({ level: 'warn', path: 'content', rule: 'figure budget', detail: `${n} ${type} blocks; the shape allows ${max}. Could it be a slide instead?`, text: type })
  }
  const deck = blocks.find((block) => block._type === 'dcScrolly')
  if (!deck) issues.push({ level: 'warn', path: 'content', rule: 'no slide deck', detail: 'the piece is built around one dcScrolly deck', text: '' })
  else if ((deck.steps ?? []).length > 8) issues.push({ level: 'warn', path: 'content', rule: 'long deck', detail: `${deck.steps.length} steps; aim for five to eight`, text: deck.title ?? '' })
  return issues
}

if (import.meta.main) {
  const dir = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  if (!dir) {
    console.error('usage: bun scripts/lint-article.mjs analysis/<slug> [--json]')
    process.exit(2)
  }
  const root = resolve(dir)
  const article = JSON.parse(readFileSync(join(root, 'article.json'), 'utf8'))
  const recipe = JSON.parse(readFileSync(join(root, 'recipe.json'), 'utf8'))
  const issues = lintArticle(article, recipe)
  if (process.argv.includes('--json')) console.log(JSON.stringify(issues, null, 2))
  else {
    for (const i of issues) console.log(`${i.level.toUpperCase().padEnd(5)} ${i.path}  ${i.rule}: ${i.detail}\n      ${i.text}`)
    const errors = issues.filter((i) => i.level === 'error').length
    console.log(`${errors} error(s), ${issues.length - errors} warning(s)`)
  }
  process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
}
