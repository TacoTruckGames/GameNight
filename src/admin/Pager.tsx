/**
 * Prev / Next over `Page<T>`.
 *
 * Offset pagination with a `hasNext` flag, so there is no total and therefore no
 * "page 3 of 7" — the honest thing to show is which page you are on and whether
 * there is another one.
 */

export function Pager({
  page,
  hasNext,
  onChange,
  busy = false,
}: {
  page: number;
  hasNext: boolean;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  if (page === 1 && !hasNext) return null;

  return (
    <div className="admin-pager">
      <button
        type="button"
        className="btn btn--sm btn--secondary"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1 || busy}
      >
        ← Previous
      </button>
      <span className="text-sm muted tnum">Page {page}</span>
      <button
        type="button"
        className="btn btn--sm btn--secondary"
        onClick={() => onChange(page + 1)}
        disabled={!hasNext || busy}
      >
        Next →
      </button>
    </div>
  );
}
