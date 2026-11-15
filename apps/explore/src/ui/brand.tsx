// The route mark: two chevrons on a line — a route heading somewhere.
// Used on the nameboard and the consent card. Colour comes from currentColor,
// so each surface dresses it in its own route colour.

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
    >
      <path
        d="M2.2 12.6 6.8 8 2.2 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
      <path
        d="M8.2 12.6 12.8 8 8.2 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  )
}
