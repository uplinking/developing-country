// nuuuwan/lk_news access for the weekly read and the backfill: pinned revision,
// article index, headline screen and cached bodies (bodies never enter git).
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export type Row = { doc_id: string; date_str: string; description: string; url_metadata: string; lang: string; newspaper_id: string }
export const CACHE = '.cache/initiatives'

async function get(url: string, kind: 'json' | 'text' = 'text') {
  const res = await fetch(url, { headers: { 'User-Agent': 'developing-country-initiatives' }, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return kind === 'json' ? res.json() : res.text()
}

export async function pinRevision(): Promise<string> {
  const head = await get('https://api.github.com/repos/nuuuwan/lk_news/commits/data', 'json') as { sha?: string }
  if (!head.sha || !/^[a-f0-9]{40}$/.test(head.sha)) throw new Error('No immutable lk_news revision')
  return head.sha
}

export async function loadIndex(sha: string): Promise<Row[]> {
  await mkdir(CACHE, { recursive: true })
  const path = `${CACHE}/docs_all-${sha}.tsv`
  let raw: string
  try { raw = await readFile(path, 'utf8') } catch {
    raw = String(await get(`https://raw.githubusercontent.com/nuuuwan/lk_news/${sha}/data/lk_news/docs_all.tsv`))
    await writeFile(path, raw)
  }
  const [header, ...lines] = raw.replace(/^﻿/, '').trim().split(/\r?\n/)
  const keys = header!.split('\t')
  for (const k of ['doc_id', 'date_str', 'description', 'url_metadata', 'lang', 'newspaper_id']) if (!keys.includes(k)) throw new Error(`lk_news index lost column ${k}`)
  const rows = lines.map(l => { const v = l.split('\t'); return Object.fromEntries(keys.map((k, i) => [k, v[i] ?? ''])) as Row })
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date_str))
  if (rows.length < 100_000) throw new Error(`lk_news index shrank to ${rows.length} rows`)
  return rows
}

// English headline screen (wide on purpose; the reader rejects what is not public money or an initiative).
const MONEY = /(\bRs\.?\s?[\d.,]+|\bLKR\b|US\s?\$|\$\s?[\d.]+|\bUSD\b|\bSDR\b|€|\byen\b|\d\s?(mn|bn|million|billion)\b)/i
const ACT = /\b(loan|grant|aid|fund(s|ing)?|financ\w*|allocat\w*|disburs\w*|tranche|budget|estimate|tender|contract|award\w*|feasibility|approv\w*|sign\w*|agreement|credit|invest\w*|project|programme|scheme|initiative|construct\w*|develop\w*|launch\w*|inaugurat\w*|opens?|opened|commission\w*|halt\w*|suspend\w*|cancel\w*|plan|proposal|Cabinet)\b/i
const FUNDER = /\b(ADB|IMF|World Bank|JICA|Japan|China|India|EXIM|AIIB|USAID|EU|KOICA|Korea|OPEC|Saudi|UNDP|AFD|KfW|Pandemic Fund|Treasury|Ministry|Cabinet|Parliament|RDA|UDA|CEB|NWSDB|SLPA|SLTB)\b/
const NOISE = /\b(cricket|T20|ODI|CSE|ASPI|shares|debenture|bourse|stocks?|rupee (closes|opens|ends)|gold price|bail|remanded|arrested|murder|killed|court|fraud case|showroom|branch|website|award ceremony)\b/i
export const englishCandidate = (r: Row) => r.lang === 'en' && !NOISE.test(r.description) && ACT.test(r.description) && (MONEY.test(r.description) || FUNDER.test(r.description))

export const OUTLET: Record<string, string> = {
  dailymirrorlk: 'Daily Mirror', dailyftlk: 'Daily FT', economynextcom: 'EconomyNext', islandlk: 'The Island', adaderanalk: 'Ada Derana',
  virakesarilk: 'Virakesari', tamilmirrorlk: 'Tamil Mirror', adalk: 'Ada', lankadeepalk: 'Lankadeepa', bbccomsinhala: 'BBC Sinhala',
  colombotelegraphcom: 'Colombo Telegraph', dbsjeyarajcom: 'dbsjeyaraj.com', newsfirstlk: 'News First',
}

export async function body(sha: string, r: Row): Promise<string> {
  await mkdir(`${CACHE}/bodies`, { recursive: true })
  const path = `${CACHE}/bodies/${r.doc_id}.txt`
  try { return await readFile(path, 'utf8') } catch {}
  try {
    const text = String(await get(`https://raw.githubusercontent.com/nuuuwan/lk_news/${sha}/data/lk_news/2020s/${r.date_str.slice(0, 4)}/${r.doc_id}/doc.txt`))
    await writeFile(path, text)
    return text
  } catch { return '' }
}

/** Article ids already read by any batch (cited, or read and rejected). */
export async function alreadyRead(root: string): Promise<Set<string>> {
  const { readdir } = await import('node:fs/promises')
  const seen = new Set<string>()
  for (const f of (await readdir(`${root}/news`)).filter(f => f.endsWith('.json'))) {
    const b = JSON.parse(await readFile(`${root}/news/${f}`, 'utf8'))
    for (const id of Object.keys(b.articles ?? {})) seen.add(id)
    for (const id of b.rejected_ids ?? []) seen.add(id)
  }
  return seen
}

/** Articles collected per Monday-week per `outlet|lang`, from the pinned index. */
export function weeklyCounts(rows: Row[], since: string): Record<string, Record<string, number>> {
  const weeks: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (r.date_str < since) continue
    const d = new Date(`${r.date_str}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    const wk = d.toISOString().slice(0, 10), k = `${r.newspaper_id}|${r.lang}`
    ;(weeks[wk] ??= {})[k] = (weeks[wk]![k] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(weeks).sort())
}
