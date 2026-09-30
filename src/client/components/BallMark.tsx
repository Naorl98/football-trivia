/**
 * The brand mark: a ball whose panels are drawn as a network.
 *
 * It carries the product's whole idea in one shape — a football that is also a
 * graph of connections, which is what a "Football IQ" is. Two inks only: the
 * page's ink for structure, the spot colour for the centre panel, so it works
 * on paper, on ink, and as a 16px favicon.
 */
export function BallMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none" }}
    >
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="2.4" />
      {/* Centre pentagon — the only filled area, in the spot colour. */}
      <path d="M24 11.5l8.6 6.3-3.3 10.2H18.7l-3.3-10.2z" fill="var(--spot)" stroke="none" />
      <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none">
        <path d="M24 11.5l8.6 6.3-3.3 10.2H18.7l-3.3-10.2z" />
        {/* Panel seams running to the edge. */}
        <path d="M24 11.5V3.2M15.4 17.8L7.6 12.9M32.6 17.8l7.8-4.9M18.7 28l-5 8.2M29.3 28l5 8.2" />
      </g>
      {/* Nodes at each junction: the "graph" reading. */}
      <g fill="currentColor">
        <circle cx="24" cy="11.5" r="2.3" />
        <circle cx="15.4" cy="17.8" r="2.3" />
        <circle cx="32.6" cy="17.8" r="2.3" />
        <circle cx="18.7" cy="28" r="2.3" />
        <circle cx="29.3" cy="28" r="2.3" />
      </g>
    </svg>
  );
}
