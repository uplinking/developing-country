# DC wordmark

The active identity is the lowercase `dc` wordmark in Overpass Bold (700),
using the font already bundled by the site and explorer. It inherits its
colour and size from its context, with tight letter spacing and no artwork.

```tsx
import { Wordmark } from '@developing-country/ui/Wordmark'

<Wordmark />
```

The shared header, site footer, and MCP sign-in screen use this wordmark.
The favicon contains outlines from the same bundled font, so it does not need
a font download to render. Visit `/brand` for light and dark examples.

## Earlier country-logo prototype

`CountryLogo` remains available for reference, but is no longer the active logo.

```tsx
import { CountryLogo } from '@developing-country/ui/CountryLogo'

<CountryLogo country="Sri Lanka" />
<CountryLogo country="Nepal" markColor="#ffffff" countryColor="#ffd400" />
<CountryLogo showCountry={false} width={48} />
```

The transparent SVG recreates the selected flowing DC concept with four mirrored
curves. Country lettering remains SVG text, using self-hosted, OFL-licensed fonts.
It is not an image or an outlined wordmark. `country` defaults to Sri Lanka;
empty country strings render the mark alone. Long names use smaller text.

Options: `markColor`, `countryColor`, `font` (script, brush, hand, sans, audiowide),
`silhouette` (flow, angular, rounded), `texture` (solid, dither), `belt` (0–100; 0 closes the middle gap with a slight overlap),
`textScale`, `textOffset`, `showCountry`, `width`, and `className`.
The prototype defaults are Kaushan brush, flowing solid DC, closed overlapping belt,
100% lettering, position 1, and a subtle text shadow. The default palette is
Ultraviolet (#5826a6 / #fa743f).

Font licenses for the prototype fonts are in `../fonts/`.
