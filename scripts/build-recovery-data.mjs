#!/usr/bin/env bun
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { readXlsxSheet, decodeXmlText } from './lib/xlsx.mjs'
import { dim, measure, evidenceFields, evidence, invariant, readSource, pdfPages, writeTables } from './lib/reviewed-source.mjs'

const ROOT = resolve(import.meta.dir, '..')
export const RECOVERY_SOURCES = JSON.parse(readFileSync(join(ROOT, 'scripts/recovery/sources.json'), 'utf8')).sources
const source = id => { const result = RECOVERY_SOURCES.find(s => s.id === id); invariant(result, `missing source ${id}`); return result }
const numeric = value => {
  const text = String(value ?? '').trim().replaceAll(',', '')
  if (!text || ['-', '..', '—', 'NA', 'N/A'].includes(text)) return null
  invariant(/^-?\d+(?:\.\d*)?(?:[%*])?$/.test(text), `unreviewed numeric token ${text}`)
  return Number(text.replace(/[%*]$/, ''))
}
function htmlText(text) { return decodeXmlText(text.replace(/<[^>]*>/g, ' ').replaceAll('&nbsp;', ' ')).replace(/\s+/g, ' ').trim() }
export function htmlTables(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '')
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table => [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => htmlText(cell[1]))))
}
const basics = (id, title, sources, vintage, fields, rows, caveats, grain) => ({ dataset_id: id, title, source_ids: sources.map(s => s.sourceId), vintage, grain, primary_key: ['record_id'], fields: [...evidenceFields, ...fields], rows, caveats })

export function buildAgriculturalIndex(html, src = source('dcs-agricultural-index')) {
  const table = htmlTables(html).find(t => t[0]?.[0] === 'Items' && t[0]?.[1] === '2014')
  invariant(table?.length === 12, 'agricultural production index table shape changed')
  const years = table[0].slice(1).map(Number)
  invariant(years.length === 12 && years.at(-1) === 2025, 'agricultural index years changed')
  const rows = table.slice(1).flatMap((r, index) => {
    invariant(r.length === years.length + 1, 'agricultural index column count')
    const crop = r[0].replace(/^\d+\.\s*/, '')
    return years.map((year, col) => ({ record_id: `${year}:${crop}`, year, crop, base_year: 2002, value: numeric(r[col + 1]), ...evidence(src, `HTML table 1, row ${index + 2}, column ${col + 2}`) }))
  })
  return basics('agricultural-production-index', 'Agricultural production volume index', [src], '2014–2025, base 2002=100', [dim('year', 'year', 'Year'), dim('crop', 'string', 'Crop/product group'), dim('base_year', 'year', 'Index base year'), measure('value', 'Production volume index', '2002=100')], rows, ['An index, not tonnes or crop area. Components and the overall index are not additive.'], 'Year × crop/product group')
}

const nutritionName = label => {
  const l = label.toLowerCase()
  if (l.includes('growth faltering')) return 'Growth faltering'
  if (l.includes('underweight')) return 'Underweight'
  if (l.includes('stunting')) return 'Stunting'
  if (l.includes('severe wasting')) return 'Severe wasting'
  if (l.includes('moderate wasting')) return 'Moderate wasting'
  if (l.includes('wasting')) return 'Wasting'
  if (l.includes('overweight')) return 'Overweight'
  throw new Error(`Unreviewed nutrition indicator ${label}`)
}
export function buildNutrition(html, home) {
  const src = source('fhb-statistics'), homeSource = source('fhb-home')
  const table = htmlTables(html).find(t => t[1]?.[0]?.includes('under 5 children with underweight'))
  invariant(table?.length === 7, 'FHB Nutrition Month table changed')
  const years = table[0].slice(1).map(Number)
  invariant(years.join(',') === '2016,2017,2018,2019,2020,2021,2022,2023,2024', 'nutrition history changed')
  const rows = table.slice(1).flatMap((r, index) => {
    invariant(r.length === 10, 'nutrition column count changed')
    const indicator = nutritionName(r[0])
    return years.map((year, col) => ({ record_id: `${year}:${indicator}`, year, indicator, programme: 'Nutrition Month', source_label: r[0], value: numeric(r[col + 1]), ...evidence(src, `Under-five Nutrition Indicators table, row ${index + 2}, column ${col + 2}`) }))
  })
  invariant(/Nutrition Month Data 2025/.test(htmlText(home)), 'homepage Nutrition Month reference year changed')
  const matches = [...home.matchAll(/<span class="nm-label">([^<]+)<\/span>[\s\S]*?<span class="nm-curr">([^<]+)<\/span>/g)]
  invariant(matches.length === 6, 'homepage nutrition indicator count changed')
  for (const match of matches) {
    const indicator = nutritionName(match[1])
    rows.push({ record_id: `2025:${indicator}`, year: 2025, indicator, programme: 'Nutrition Month', source_label: match[1], value: numeric(match[2]), ...evidence(homeSource, `Nutrition Month Data 2025, ${match[1]}, current value`, 'The homepage publishes six indicators; indicators absent for 2025 remain absent rather than inferred.') })
  }
  invariant(rows.every(r => r.value === null || r.value >= 0 && r.value <= 100), 'nutrition percent out of range')
  return basics('child-nutrition-annual', 'Under-five nutrition indicators', [src, homeSource], 'Nutrition Month 2016–2025, available indicators', [dim('year', 'year', 'Year'), dim('indicator', 'string', 'Nutrition indicator'), dim('programme', 'string', 'Reporting programme'), dim('source_label', 'string', 'Published indicator label'), measure('value', 'Reported prevalence', '% children assessed')], rows, ['Nutrition Month administrative campaign data, not a population-representative household survey. Denominators and assessment coverage may vary.', 'Moderate and severe wasting are components of wasting; do not add them to the total. Some indicators are not published for every year.'], 'Year × under-five Nutrition Month indicator')
}

export function buildNcpi(text, src = source('ncpi-food-nonfood')) {
  const rows = [], names = ['All items', 'Food', 'Nonfood']
  const months = new Map(['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i) => [m,i+1]))
  let year = null
  for (const [index, line] of text.split('\n').entries()) {
    const match = /^\s*(?:(20\d{2})\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+/.exec(line)
    if (!match) continue
    if (match[1]) year = Number(match[1])
    invariant(year && year >= 2022, 'NCPI year missing')
    const period = `${year}-${String(months.get(match[2])).padStart(2, '0')}`
    const ranges = [[18,33,44,55,67],[67,78,88,98,108],[108,120,130,140,153]]
    ranges.forEach((boundaries, group) => {
      const values = boundaries.slice(0,-1).map((start, col) => numeric(line.slice(start,boundaries[col+1]).trim()))
      invariant(values[0] !== null && values[0] > 0, `NCPI index missing ${period}:${names[group]}`)
      rows.push({ record_id: `${period}:${names[group]}`, period, group: names[group], base_year: 2021, index_value: values[0], month_on_month_pct: values[1], year_on_year_pct: values[2], annual_average_inflation_pct: values[3], ...evidence(src, `PDF physical page 1, text line ${index + 1}, ${names[group]}`) })
    })
  }
  invariant(rows.length === 56*3 && rows[0].period === '2022-01' && rows.at(-1).period === '2026-08', 'NCPI historical coverage changed')
  return basics('ncpi-monthly', 'National consumer prices: food and nonfood', [src], 'January 2022–August 2026, base 2021=100', [dim('period', 'period', 'Month'), dim('group', 'string', 'Price group'), dim('base_year', 'year', 'Index base year'), measure('index_value', 'Consumer price index', '2021=100'), measure('month_on_month_pct', 'Month-on-month inflation', '%'), measure('year_on_year_pct', 'Year-on-year inflation', '%'), measure('annual_average_inflation_pct', 'Annual-average inflation', '%')], rows, ['National NCPI differs from Colombo CCPI. Source blanks stay null, including unavailable early inflation rates. Earlier index bases are not spliced into this series.', 'Annual summary rows in the source are excluded from this monthly table.'], 'Month × national price group')
}

const sexGroups = ['Both sexes', 'Male', 'Female']
function periodRows(page, count) {
  const result=[]
  for (const [i,line] of page.split('\n').entries()) {
    const match = /^\s*((?:19|20)\d{2}(?:\s*Q[1-4])?)\s+(.+)$/.exec(line)
    if (!match) continue
    const tokens=match[2].trim().split(/\s+/)
    if (tokens.length !== count || !tokens.every(t => /^\d[\d,]*(?:\.\d+)?\*?$/.test(t))) continue
    const p=match[1].replaceAll(' ','').replace('Q','-Q')
    result.push({period:p, tokens, values:tokens.map(numeric), line:i+1})
  }
  return result
}
function sexBlocks(rows) {
  invariant(rows.length > 0,'no historical labour rows')
  const blocks=[[]], first=rows[0].period
  for (const row of rows) {
    if (row.period === first && blocks.at(-1).length) blocks.push([])
    blocks.at(-1).push(row)
  }
  invariant(blocks.length === 3,'labour sex-block structure changed')
  return blocks
}
function latestRows(rows, keyFields) {
  const latest=new Map()
  for (const row of rows) { if(row.period_ambiguous)continue; const key=JSON.stringify(keyFields.map(k=>row[k])); if (!latest.has(key)||latest.get(key)<row.edition)latest.set(key,row.edition) }
  return rows.map(row => ({...row,is_latest_revision:!row.period_ambiguous && latest.get(JSON.stringify(keyFields.map(k=>row[k])))===row.edition}))
}
export function buildLabour(documents) {
  const status=[],profiles=[]
  for (const {src,pages} of documents) {
    const stats=src.statusPages.flatMap(page=>periodRows(pages[page-1],8).map(row=>({...row,page})))
    sexBlocks(stats).forEach((block,sex)=>{
      for (const row of block) {
        if (Number(row.period.slice(0,4))<2013)continue
        const [population,labour_force,participation_pct,employed,employed_labour_force_pct,unemployed,unemployment_pct,not_in_labour_force]=row.values
        invariant(Math.abs(population-labour_force-not_in_labour_force)<=3 && Math.abs(labour_force-employed-unemployed)<=3,`labour counts disagree ${src.id}:${row.period}`)
        const reviewedRate = src.reviewedRateDiscrepancies?.find(r=>r.period===row.period&&r.sex===sexGroups[sex]&&r.participation_pct===participation_pct)
        invariant((Math.abs(participation_pct-100*labour_force/population)<=.15 || reviewedRate) && Math.abs(unemployment_pct-100*unemployed/labour_force)<=.15,`labour rate denominator changed ${src.id}:${sexGroups[sex]}:${row.period}`)
        status.push({record_id:`${src.id}:${sex}:${row.period}`,edition:src.edition,period:row.period,frequency:row.period.includes('-Q')?'quarterly':'annual',sex:sexGroups[sex],population,labour_force,participation_pct,employed,employed_labour_force_pct,unemployed,unemployment_pct,not_in_labour_force,...evidence(src,`PDF physical page ${row.page}, Table 1${sex===0?'':sex===1?'A':'B'}, text line ${row.line}`,reviewedRate?.note??(src.edition>='2026-Q1'?'Source reports a revision of 2025 estimates using Census 2024 weights; do not hide the break.':null))})
      }
    })
    const categories={3:['All ages','15–19','20–24','25–29','30–39','40+'],4:['All education levels','Grade 5 and below','Grades 6–10','GCE O/L or equivalent','GCE A/L and above'],5:['All employment statuses','Employee','Public employee','Private employee','Employer','Own-account worker','Contributing family worker'],9:['All ages','15–19','20–24','25–29','30–39','40+'],10:['All education levels','Grade 5 and below','Grades 6–10','GCE O/L or equivalent','GCE A/L and above']}
    for (const [table,page] of Object.entries(src.profilePages)) {
      const labels=categories[table], rows=periodRows(pages[page-1],labels.length)
      sexBlocks(rows).forEach((block,sex)=>{
        for (const row of block) {
          if (Number(row.period.slice(0,4))<2013)continue
          invariant(Math.abs(row.values[0]-100)<=.2 && row.values.slice(1).every(v=>v>=0&&v<=100),`labour composition percent changed ${src.id} Table ${table} ${row.period}: ${row.values}`)
          const correction=src.reviewedPeriods?.find(c=>c.table===table&&c.sex===sexGroups[sex]&&c.line===row.line)
          if(correction)invariant(row.period===correction.printed,'reviewed labour period moved')
          const sourcePeriod=row.period, period=correction?.corrected??row.period
          const group=Number(table)>=9?'Unemployed':'Employed',breakdown=['3','9'].includes(table)?'Age':table==='5'?'Employment status':'Education'
          labels.forEach((category,index)=>profiles.push({record_id:`${src.id}:${table}:${sex}:${row.line}:${index}`,edition:src.edition,period,source_period:sourcePeriod,period_ambiguous:correction?.ambiguous??false,frequency:row.period.includes('-Q')?'quarterly':'annual',sex:sexGroups[sex],population_group:group,breakdown,category,value:row.values[index],high_cv:row.tokens[index].includes('*')?true:null,...evidence(src,`PDF physical page ${page}, Table ${table}${sex===0?'':sex===1?'A':'B'}, text line ${row.line}, column ${index+2}`,correction?.note??null)}))
        }
      })
    }
  }
  const sources=documents.map(d=>d.src), vintage='Annual 2013–2025 and available quarterly comparisons through Q1 2026; nine report vintages'
  const dims=[dim('edition','string','Quarterly report edition'),dim('period','string','Year or quarter'),dim('frequency','string','Frequency'),dim('sex','string','Sex'),dim('is_latest_revision','boolean','Latest reviewed edition for this observation')]
  return [
    basics('labour-force-sex-history','Labour force by sex: annual and quarterly history',sources,vintage,[...dims,measure('population','Population aged 15+','people'),measure('labour_force','Labour force','people'),measure('participation_pct','Labour-force participation','% population aged 15+'),measure('employed','Employed','people'),measure('employed_labour_force_pct','Employed share of labour force','% labour force'),measure('unemployed','Unemployed','people'),measure('unemployment_pct','Unemployment rate','% labour force'),measure('not_in_labour_force','Outside labour force','people')],latestRows(status,['period','sex']),['Survey estimates, with sampling and rounding uncertainty. Annual and quarterly observations are separate frequencies.','Earlier report vintages are retained. 2025 population-weight revisions must remain visible; this does not reweight earlier historical quarters.'], 'Report edition × period × sex'),
    basics('labour-employment-profile-history','Employment and unemployment composition',sources,vintage,[...dims,dim('source_period','string','Printed year or quarter'),dim('period_ambiguous','boolean','Ambiguous printed period; excluded from latest series'),dim('population_group','string','Population group'),dim('breakdown','string','Breakdown'),dim('category','string','Published category'),dim('high_cv','boolean','Source caution flag'),measure('value','Share within the selected population','%')],latestRows(profiles,['period','sex','population_group','breakdown','category']),['Composition of unemployed people is not the unemployment rate of an age/education group.','Public/private employees are components of Employee; totals and subtotals overlap. Rounded totals can be 100.1%. Selected historical tables, not every survey table.', 'High-CV asterisks are retained where extractable. Other editions use shaded cells; those flags are not fully transcribed, and a null flag does not establish reliability. Ambiguous printed quarters are excluded from latest-series selection.'], 'Report edition × period × sex × population group × breakdown × category'),
  ]
}

function excelColumn(index) { let name='';for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name }
export function buildPaddy(workbooks) {
  const grouped=new Map()
  for (const {src,sheet} of workbooks) {
    const match=/^paddy-(sown|harvested|yield|production)-(maha|yala)$/.exec(src.id)
    invariant(match,'unknown paddy source')
    const [,metric,season]=match
    // oxlint-disable-next-line strict-types/no-runtime-typeof -- Workbook cells are mixed primitives; this parser locates the reviewed year header.
    const headerIndex=sheet.findIndex(r=>r?.some(v=>typeof v==='string'&&/^(?:19|20)\d{2}[/-](?:19|20)\d{2}$/.test(v))||r?.some(v=>Number.isInteger(v)&&v>=1979&&v<=2026))
    invariant(headerIndex>=0,'paddy year header missing')
    // oxlint-disable-next-line strict-types/no-runtime-typeof -- Validate the raw workbook header before choosing its geography column.
    const header=sheet[headerIndex], columns=[], geographyColumn=header.findIndex(v=>typeof v==='string'&&v.trim().toLowerCase()==='district')
    invariant(geographyColumn>=0,'paddy geography column missing')
    header.forEach((raw,col)=>{
      if (raw===null||raw===undefined)return
      let label=String(raw).trim(), year
      if(src.id==='paddy-production-yala'&&raw===198&&col===2){label='1980';year=1980}
      if (/^(?:19|20)\d{2}$/.test(label))year=Number(label)
      else if (/^(?:19|20)\d{2}[/-](?:19|20)\d{2}$/.test(label)) {
        if(label==='2000/2021'){label='2020/2021';year=2021}
        else {const parts=label.split(/[/-]/).map(Number);invariant(parts[1]===parts[0]+1,`malformed paddy year ${raw}`);year=parts[1]}
      } else return
      const valueColumn=metric==='production'?col:col+3
      if(metric!=='production')invariant(String(sheet[headerIndex+1]?.[valueColumn]).trim().toLowerCase()==='total',`paddy total column shifted ${src.id} ${raw}`)
      columns.push({col:valueColumn,year,label,raw:String(raw)})
    })
    invariant(columns.length>=40,'paddy historical coverage collapsed')
    const rows=grouped.get(metric)??[]
    let geographyCount=0
    for (let r=headerIndex+(metric==='production'?1:2);r<sheet.length;r++) {
      const rawLabel=sheet[r]?.[geographyColumn]
      // oxlint-disable-next-line strict-types/no-runtime-typeof -- Reject non-label workbook cells at the parsing boundary.
      if(typeof rawLabel!=='string'||!rawLabel.trim()||rawLabel.length>60)continue
      const geography=rawLabel.trim(),type=geography==='SRI LANKA'?'national':/MAHAWELI|UDAWALAWE|HIGHLAND/i.test(geography)?'special area':'district'
      geographyCount++
      for (const column of columns) {
        const token=sheet[r][column.col], value=numeric(token)
        const note=column.raw==='2000/2021'?'Source prints 2000/2021; reviewed as 2020/2021 from the surrounding sequence and matching production workbook.':column.raw==='198'?'Source prints 198; reviewed as 1980 between the 1979 and 1981 columns.':metric==='yield'&&value>15000?'Unusually large yield retained exactly as published; do not silently repair.':null
        rows.push({record_id:`${src.id}:${r}:${column.col}`,year:column.year,season:season==='maha'?'Maha':'Yala',season_label:column.label,source_season_label:column.raw,geography,geography_type:type,value,source_value:token===null||token===undefined?null:String(token),...evidence(src,`Workbook sheet1, cell ${excelColumn(column.col)}${r+1}`,note)})
      }
    }
    invariant(geographyCount>=26&&geographyCount<=35,`paddy geography count ${src.id}: ${geographyCount}`)
    grouped.set(metric,rows)
  }
  const details={sown:['paddy-sown-area-history','Paddy sown area','hectares'],harvested:['paddy-harvested-area-history','Paddy harvested area','hectares'],yield:['paddy-yield-history','Paddy yield','kg/hectare'],production:['paddy-production-history','Paddy production','thousand tonnes']}
  return [...grouped].map(([metric,rows])=>{
    const [id,title,unit]=details[metric],sources=workbooks.filter(w=>w.src.id.includes(`-${metric}-`)).map(w=>w.src)
    return basics(id,`${title} by district and season`,sources,'Historical seasonal workbooks, 1979 onward; latest year varies by measure',[dim('year','year','Season end year'),dim('season','string','Season'),dim('season_label','string','Cultivation season'),dim('source_season_label','string','Printed season heading'),dim('geography','string','Published geography'),dim('geography_type','string','Geography type'),dim('source_value','string','Printed cell value'),measure('value',title,unit)],rows,['Published total irrigation category only; the source also contains unimported irrigation-specific columns.','National totals and separately reported scheme areas are retained; they are not all additive. Source footnotes change Mahaweli/Udawalawe reporting into districts after 2017/18.','Source dashes remain null. Geography names are not silently forced onto present-day administrative boundaries. Sown area, harvested area, yield and production have different definitions and latest periods.'], 'Geography × season × year, published total')
  })
}

export function buildRecoveryTables(directory, fetchRemote=false) {
  const content=new Map()
  for(const src of RECOVERY_SOURCES)content.set(src.id,readSource(src,directory,fetchRemote))
  const text=id=>new TextDecoder().decode(content.get(id).bytes)
  return [buildAgriculturalIndex(text('dcs-agricultural-index')),buildNutrition(text('fhb-statistics'),text('fhb-home')),buildNcpi(pdfPages(content.get('ncpi-food-nonfood').path)[0]),...buildLabour(RECOVERY_SOURCES.filter(s=>s.id.startsWith('lfs-')).map(src=>({src,pages:pdfPages(content.get(src.id).path)}))),...buildPaddy(RECOVERY_SOURCES.filter(s=>s.id.startsWith('paddy-')).map(src=>({src,sheet:readXlsxSheet(content.get(src.id).path)})))]
}
if(import.meta.main){
  const arg=process.argv.indexOf('--source-dir'),directory=arg>=0?resolve(process.argv[arg+1]):mkdtempSync(join(tmpdir(),'dc-recovery-'))
  try{writeTables(buildRecoveryTables(directory,arg<0),join(ROOT,'public/data'),process.argv.includes('--check'))}finally{if(arg<0)rmSync(directory,{recursive:true,force:true})}
}
