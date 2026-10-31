/**
 * Springs, the way Apple describes them: a damping ratio (1 = no overshoot,
 * lower = bouncier) and a response in seconds (how quickly it gets there),
 * rather than mass, stiffness and damping. docs/design/apple.md › Motion.
 *
 * Two uses: springEasing() turns a spring into a CSS linear() easing and a
 * duration, which is how the stylesheets get spring motion with plain
 * transitions (the --spring* tokens in app/styles/brand.css are its output);
 * animateSpring() runs one in JavaScript, starting from the current value and
 * the finger's velocity, for the moment a drag lets go.
 */

export type Spring = { damping: number; response: number };

/** The house springs. Change one here, then regenerate the CSS tokens (see spring.test.ts). */
export const SPRINGS = {
  /** Most things: critically damped, settles without overshoot. */
  smooth: { damping: 1, response: 0.4 },
  /** Small state changes: a thumb, a knob, a chevron. */
  snappy: { damping: 1, response: 0.28 },
  /** Only after a gesture carried momentum (a flick, a drag let go). */
  bouncy: { damping: 0.8, response: 0.4 },
} satisfies Record<string, Spring>;

/** Within this of the target, and the motion has settled. */
const REST = 0.001;

/**
 * Where a spring from 0 towards 1 is after `t` seconds, given a starting
 * velocity in units per second (1 unit = the whole distance).
 */
export function springAt(t: number, { damping, response }: Spring, velocity = 0): number {
  const omega = (2 * Math.PI) / response;
  const x0 = -1;
  if (damping < 1) {
    const decay = damping * omega;
    const omegaD = omega * Math.sqrt(1 - damping * damping);
    const offset = Math.exp(-decay * t) * (x0 * Math.cos(omegaD * t) + ((velocity + decay * x0) / omegaD) * Math.sin(omegaD * t));
    return 1 + offset;
  }
  return 1 + Math.exp(-omega * t) * (x0 + (velocity + omega * x0) * t);
}

/** How long the spring takes to come to rest, in seconds. */
export function settleTime(spring: Spring, velocity = 0): number {
  const step = 1 / 240;
  let still = 0;
  let previous = springAt(0, spring, velocity);
  for (let t = step; t < 10; t += step) {
    const value = springAt(t, spring, velocity);
    still = Math.abs(1 - value) < REST && Math.abs(value - previous) < REST * step * 60 ? still + 1 : 0;
    if (still >= 12) return t - 11 * step;
    previous = value;
  }
  return 10;
}

const round = (value: number, places: number) => Number(value.toFixed(places));

/** The spring as a CSS linear() easing plus the duration to run it for. */
export function springEasing(spring: Spring, points = 32): { easing: string; ms: number } {
  const total = settleTime(spring);
  const stops: string[] = [];
  for (let index = 0; index <= points; index++) {
    // More samples early, where a spring changes fastest.
    const progress = (index / points) ** 1.6;
    const value = index === points ? 1 : round(springAt(progress * total, spring), 4);
    stops.push(index === 0 || index === points ? String(value) : `${value} ${round(progress * 100, 2)}%`);
  }
  return { easing: `linear(${stops.join(', ')})`, ms: Math.round(total * 1000) };
}

/**
 * Runs a spring from `from` to `to`, starting at `velocity` (units per
 * second, e.g. px/s from a drag), calling `onFrame` with each value. Returns
 * a stop function; a new animation should start from the last value it
 * reported, which is what keeps motion continuous when it is interrupted.
 */
export function animateSpring(
  from: number,
  to: number,
  spring: Spring,
  { velocity = 0, onFrame, onDone }: { velocity?: number; onFrame: (value: number) => void; onDone?: () => void },
): () => void {
  const distance = to - from;
  if (distance === 0) {
    onFrame(to);
    onDone?.();
    return () => {};
  }
  // springAt() measures velocity in whole distances per second.
  const relative = velocity / distance;
  const total = settleTime(spring, relative);
  const start = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const t = (now - start) / 1000;
    if (t >= total) {
      onFrame(to);
      onDone?.();
      return;
    }
    onFrame(from + distance * springAt(t, spring, relative));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/**
 * Where a flick would come to rest, the way scrolling decelerates: Apple's
 * projection from "Designing Fluid Interfaces". Velocity in px/s.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Resistance past an edge: the further past it, the less the element follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
