// Placeholders shown while a lazily loaded screen or part of one arrives.

/** A whole tab: carries its own .screen-body so the layout does not jump. */
export function TabLoading() {
  return <div className="screen-body field"><p className="fd-empty">Loading…</p></div>;
}

// For a part of a screen that already sits inside .screen-body: a second one
// would add its own padding and scroll box for the moment it shows.
export function PartLoading() {
  return <p className="fd-empty">Loading…</p>;
}
