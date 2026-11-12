/**
 * The picture behind the waitlist hero: the Orbis ring as an eclipse in a
 * quiet starfield, with a small moon on a tilted orbit and the odd shooting
 * star.
 *
 * Everything is CSS (the "Eclipse" block in app/styles/marketing.css): no
 * script, no canvas, nothing for a weak phone to struggle with. Only transform
 * and opacity animate, and all of it stops for visitors who ask for reduced
 * motion. Decorative, so it is hidden from assistive tech and sits under the
 * copy; the page's own black stays the background.
 */
export function EclipseBackdrop() {
  return (
    <div className="wl-backdrop wl-space" aria-hidden="true">
      <div className="wl-stars wl-stars-far" />
      <div className="wl-stars wl-stars-near" />
      <span className="wl-shooting" />
      <div className="wl-eclipse">
        <div className="wl-eclipse-glow" />
        <div className="wl-eclipse-corona" />
        <div className="wl-eclipse-core" />
        <div className="wl-eclipse-ring" />
        <div className="wl-moon-track">
          <div className="wl-moon-turn"><span className="wl-moon" /></div>
        </div>
      </div>
      <div className="wl-space-veil" />
    </div>
  );
}
