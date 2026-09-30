/**
 * The brand mark: a ball whose panels double as a small network.
 *
 * One idea in one shape — a football that is also a graph of connections,
 * which is what a "Football IQ" is. Two colours only, so it survives at 16px
 * as a favicon and inside a button.
 */
export function BallMark({
  size = 30,
  className,
  spinning = false,
}: {
  size?: number;
  className?: string;
  /** Slow idle rotation, for the hero. */
  spinning?: boolean;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{
        flex: "none",
        animation: spinning ? "spin-slow 26s linear infinite" : undefined,
      }}
      data-ambient={spinning ? "" : undefined}
    >
      <circle cx="24" cy="24" r="21.5" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.9" />
      <path d="M24 12l8.2 6-3.1 9.7H18.9L15.8 18z" fill="var(--green)" />
      <g stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" fill="none" opacity="0.75">
        <path d="M24 12l8.2 6-3.1 9.7H18.9L15.8 18z" />
        <path d="M24 12V4.2M15.8 18l-7.4-4.6M32.2 18l7.4-4.6M18.9 27.7l-4.7 7.8M29.1 27.7l4.7 7.8" />
      </g>
      <g fill="currentColor">
        <circle cx="24" cy="12" r="2.1" />
        <circle cx="15.8" cy="18" r="2.1" />
        <circle cx="32.2" cy="18" r="2.1" />
        <circle cx="18.9" cy="27.7" r="2.1" />
        <circle cx="29.1" cy="27.7" r="2.1" />
      </g>
    </svg>
  );
}
