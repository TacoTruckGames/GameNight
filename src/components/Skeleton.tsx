/** Loading placeholders (S4). Shaped like the real card so nothing jumps. */

export function Skeleton({ width = "100%", height = 16 }: { width?: string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function EventCardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <div className="card__link">
        <Skeleton width="70%" height={20} />
        <Skeleton width="45%" height={14} />
        <Skeleton width="55%" height={14} />
      </div>
      <div className="card__row">
        <Skeleton width="38%" height={28} />
        <Skeleton width="30%" height={44} />
      </div>
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
