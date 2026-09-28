// Shown while a screen's server work is still running: the Field ground with a
// few quiet placeholder rows, so the page never flashes blank.
export default function Loading() {
  return (
    <main className="screen-body field fd-boundary" aria-busy="true">
      <p className="fd-empty" role="status">Loading…</p>
      <div className="fd-skeleton" aria-hidden="true">
        <span className="wide" />
        <span />
        <span />
        <span className="short" />
      </div>
    </main>
  );
}
