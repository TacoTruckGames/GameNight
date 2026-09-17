/** Loading placeholders (S4). Shaped like the real card so nothing jumps. */

export function Skeleton({ width = "100%", height = 16 }: { width?: string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

/**
 * Shaped like `EventCard`, down to the grid.
 *
 * Not "three grey bars in a box": the placeholder has to be the same height as
 * the thing that replaces it, or every list shifts under the reader's thumb the
 * moment it loads. Same class, same rows, same rail.
 */
export function EventCardSkeleton() {
  return (
    <div className="ecard" aria-hidden="true">
      <span className="ecard__rail">
        <Skeleton width="30px" height={18} />
      </span>
      <span className="ecard__title">
        <Skeleton width="72%" height={19} />
      </span>
      <span className="ecard__meta">
        <Skeleton width="55%" height={15} />
      </span>
      <span className="ecard__venue">
        <Skeleton width="68%" height={15} />
      </span>
      <span className="btn" style={{ background: "transparent", border: 0, padding: 0 }}>
        <Skeleton width="64px" height={44} />
      </span>
    </div>
  );
}

/** The three-card list placeholder used by every event list. */
export function EventListSkeleton({ count = 3, label = "Loading events" }: { count?: number; label?: string }) {
  return (
    <div className="stack" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <EventCardSkeleton key={index} />
      ))}
    </div>
  );
}
