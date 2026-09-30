/**
 * The one loading state in the product.
 *
 * It announces itself politely and draws three pip-shaped dots rather than a
 * spinner, so waiting looks like part of the same design rather than a borrowed
 * widget.
 */
export function Loading({ label }: { label: string }) {
  return (
    <p className="gate-status" role="status" aria-live="polite">
      <span className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {label}
    </p>
  );
}
