import { Wordmark } from './Wordmark'
import './playground.css'

export function BrandPlayground() {
  return <section className="brand-lab" aria-label="DC identity">
    <header>
      <p className="brand-lab__eyebrow">Developing Country</p>
      <h1><Wordmark /></h1>
      <p className="brand-lab__tagline">Public data. Shared understanding.</p>
    </header>
    <div className="brand-lab__samples">
      <figure><Wordmark /><figcaption>On paper</figcaption></figure>
      <figure className="brand-lab__inverse"><Wordmark /><figcaption>In reverse</figcaption></figure>
    </div>
  </section>
}
