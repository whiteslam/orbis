// The Glass wallpaper: three soft, low-saturation shapes and a faint dot texture
// behind every screen. Decorative only; the frosted cards read against it.
export function Wallpaper() {
  return (
    <div className="glass-wall" aria-hidden="true">
      <i className="glass-blob one" />
      <i className="glass-blob two" />
      <i className="glass-blob three" />
      <i className="glass-grain" />
    </div>
  );
}
