import { Wordmark } from './brand/Wordmark'
import './site-header.css'

interface SiteHeaderProps {
  siteUrl: string
  explorerUrl: string
  /** The host renders MCP and Sign in as its own stateful controls (the
   *  explorer's toolbar: live-agent lamp, account disc, sign-out), so the
   *  header leaves those two links out instead of repeating them. */
  inAppActions?: boolean
}

const MENU_ID = 'dc-site-menu'
const DASHBOARDS_ID = 'dc-site-dashboards'

interface NavLink { href: string; label: string; note: string; primary?: boolean }

/** The same navigation on the public-site and explorer Workers. The Dashboards
 *  menu and the phone menu are native popovers, so the static Astro render
 *  needs no hydration: they open on click, close on Escape or a click outside. */
export function SiteHeader({ siteUrl, explorerUrl, inAppActions = false }: SiteHeaderProps) {
  const site = siteUrl.replace(/\/$/, '')
  const explorer = explorerUrl.replace(/\/$/, '')
  const datasets: NavLink = { href: `${site}/data`, label: 'Datasets', note: 'Every table' }
  const dashboards: NavLink[] = [
    { href: `${site}/funding`, label: 'Funding', note: 'Where the money goes' },
    { href: `${site}/enterprises`, label: 'Enterprises', note: 'Who owns what' },
  ]
  const after: NavLink[] = [
    { href: `${site}/analysis`, label: 'Thoughts', note: 'Essays' },
    ...(inAppActions ? [] : [
      { href: `${explorer}/?connect=1`, label: 'MCP', note: 'Connect an agent' },
      { href: `${explorer}/?signin=1`, label: 'Sign in', note: 'Account', primary: true },
    ]),
  ]
  const phone = [datasets, ...dashboards, ...after]
  const inline = (link: NavLink) => <a key={link.label} href={link.href}
    className={link.primary ? 'dc-site-header__primary' : undefined}>{link.label}</a>
  return <header className="dc-site-header">
    <nav className="dc-site-header__nav" aria-label="Primary navigation">
      <a className="dc-site-header__brand" href={`${site}/`} aria-label="Developing Country home">
        <Wordmark className="dc-site-header__wordmark" />
      </a>
      <label className="dc-site-header__country" title="Sri Lanka">
        <span className="dc-site-header__country-name" aria-hidden="true">Sri Lanka</span>
        <span className="dc-site-header__country-code" aria-hidden="true">LK</span>
        <select aria-label="Choose country" defaultValue="lk"><option value="lk">Sri Lanka</option></select>
        <span className="dc-site-header__chevron" aria-hidden="true" />
      </label>
      <div className="dc-site-header__links">
        {inline(datasets)}
        <button className="dc-site-header__group" type="button" popoverTarget={DASHBOARDS_ID}>
          Dashboards<span className="dc-site-header__chevron" aria-hidden="true" />
        </button>
        <div className="dc-site-header__dropdown" id={DASHBOARDS_ID} popover="auto">
          {dashboards.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}
        </div>
        {after.map(inline)}
      </div>
      <button className="dc-site-header__menu-button" type="button" popoverTarget={MENU_ID}>
        <span className="dc-site-header__menu-open">Menu</span>
        <span className="dc-site-header__menu-close">Close</span>
        <span className="dc-site-header__menu-glyph" aria-hidden="true" />
      </button>
      <div className="dc-site-header__menu" id={MENU_ID} popover="auto">
        {phone.map((link, index) => <a key={link.label} href={link.href}
          className={link.primary ? 'dc-site-header__primary' : undefined}>
          <span className="dc-site-header__roundel" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="dc-site-header__menu-label">{link.label}</span>
          <span className="dc-site-header__menu-note" aria-hidden="true">{link.note}</span>
        </a>)}
      </div>
    </nav>
  </header>
}
