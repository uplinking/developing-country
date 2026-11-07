export const PUBLIC_DATA_THEMES = [
  { id: 'AGRI', label: 'Agriculture, fisheries, forestry and food' },
  { id: 'ECON', label: 'Economy and finance' },
  { id: 'EDUC', label: 'Education, culture and sport' },
  { id: 'ENER', label: 'Energy' },
  { id: 'ENVI', label: 'Environment' },
  { id: 'GOVE', label: 'Government and public sector' },
  { id: 'HEAL', label: 'Health' },
  { id: 'INTR', label: 'International issues' },
  { id: 'JUST', label: 'Justice, legal system and public safety' },
  { id: 'REGI', label: 'Regions and cities' },
  { id: 'SOCI', label: 'Population and society' },
  { id: 'TECH', label: 'Science and technology' },
  { id: 'TRAN', label: 'Transport' },
] as const

export type PublicDataThemeId = typeof PUBLIC_DATA_THEMES[number]['id']

export interface PublicDataTheme {
  id: PublicDataThemeId
  label: string
  uri: string
}

export function isPublicDataThemeId(value: string): value is PublicDataThemeId {
  return PUBLIC_DATA_THEMES.some((theme) => theme.id === value)
}

export function publicDataTheme(id: PublicDataThemeId): PublicDataTheme {
  const theme = PUBLIC_DATA_THEMES.find((candidate) => candidate.id === id)
  if (!theme) throw new Error(`Unknown public data theme ${id}`)
  return {
    ...theme,
    uri: `http://publications.europa.eu/resource/authority/data-theme/${theme.id}`,
  }
}
