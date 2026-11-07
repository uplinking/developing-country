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

/** The same navigation on the public-site and explorer Workers. Phones get a
 *  native popover menu, so the static Astro render needs no hydration. */
export function SiteHeader({ siteUrl, explorerUrl, inAppActions = false }: SiteHeaderProps) {
  const site = siteUrl.replace(/\/$/, '')
  const explorer = explorerUrl.replace(/\/$/, '')
  const links = [
    { href: `${site}/data`, label: 'Data', note: 'Datasets' },
    { href: `${site}/initiatives`, label: 'Initiatives', note: 'Projects & funding' },
    { href: `${site}/analysis`, label: 'Thoughts', note: 'Essays' },
    ...(inAppActions ? [] : [
      { href: `${explorer}/?connect=1`, label: 'MCP', note: 'Connect an agent' },
      { href: `${explorer}/?signin=1`, label: 'Sign in', note: 'Account', primary: true },
    ]),
  ]
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
        {links.map((link) => <a key={link.label} href={link.href}
          className={link.primary ? 'dc-site-header__primary' : undefined}>{link.label}</a>)}
      </div>
      <button className="dc-site-header__menu-button" type="button" popoverTarget={MENU_ID}>
        <span className="dc-site-header__menu-open">Menu</span>
        <span className="dc-site-header__menu-close">Close</span>
        <span className="dc-site-header__menu-glyph" aria-hidden="true" />
      </button>
      <div className="dc-site-header__menu" id={MENU_ID} popover="auto">
        {links.map((link, index) => <a key={link.label} href={link.href}
          className={link.primary ? 'dc-site-header__primary' : undefined}>
          <span className="dc-site-header__roundel" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="dc-site-header__menu-label">{link.label}</span>
          <span className="dc-site-header__menu-note" aria-hidden="true">{link.note}</span>
        </a>)}
      </div>
    </nav>
  </header>
}
