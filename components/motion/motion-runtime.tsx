'use client';

import { useEffect } from 'react';
import { animateSpring, project, rubberband, springEasing, SPRINGS } from '@/lib/motion/spring';

/**
 * The app's fluid motion, in one place (docs/design/apple.md › Motion).
 *
 * Mounted once, it watches the page rather than being wired into each
 * component, so every screen gets the same behaviour:
 *
 * - Selection glides. When a segmented control, the tab bar or the desktop
 *   rail changes its selected item, a copy of the selected background slides
 *   from the old item to the new one on a spring, the way iOS moves a
 *   segmented thumb or the tab bar's selection.
 * - Sheets leave the way they came. Tapping a sheet's Close button plays the
 *   entrance backwards before the sheet goes; a keyboard Escape or Enter
 *   closes at once (keyboard actions never animate).
 * - Sheets follow the finger. On a phone, the Settings and Ask sheets can be
 *   dragged down by their top bar: 1:1 with the finger, resisting upward,
 *   and on release the finger's velocity decides, by projecting where the
 *   flick would come to rest, whether the sheet goes or springs back.
 *
 * Press feedback and entrances are plain CSS in app/styles/motion.css. All of
 * it stands down under Reduce Motion.
 */

/** Groups whose selected item gets a gliding background, and how each marks the selected one. */
const GROUPS = '.fd-tabs.glass-seg, .fd-seg, .so-mini, .bottom-nav, .dk-rail, [data-glide]';
const SELECTED = '[aria-selected="true"], [aria-checked="true"], [aria-current="page"], .active';
const WATCHED = ['aria-selected', 'aria-checked', 'aria-current', 'class'];

/** Sheets that rise from the foot, the bar that drags each one, and its Close button. */
const SHEETS = [
  // "Close", or a fuller name such as "Close settings".
  { sheet: '.settings-sheet', handle: '.settings-head, .sheet-grabber', close: '.settings-head [aria-label^="Close"]' },
  { sheet: '.talk-sheet', handle: '.talk-head, .sheet-grabber', close: '.talk-head [aria-label^="Close"]' },
];

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => matchMedia('(max-width: 720px)').matches;

function isSelected(element: Element) {
  return element.matches(SELECTED);
}

/** Slides a copy of `to`'s background from where `from` is to where `to` is. */
function glide(group: HTMLElement, from: HTMLElement, to: HTMLElement) {
  const box = group.getBoundingClientRect();
  const start = from.getBoundingClientRect();
  const end = to.getBoundingClientRect();
  if (!start.width || !end.width || (start.left === end.left && start.top === end.top)) return;
  const look = getComputedStyle(to);
  // Nothing to carry if the selected item has no background of its own.
  if (look.backgroundColor === 'rgba(0, 0, 0, 0)' && look.backgroundImage === 'none') return;

  const ghost = document.createElement('span');
  ghost.className = 'glide-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${end.width}px`,
    height: `${end.height}px`,
    borderRadius: look.borderRadius,
    background: look.background,
    boxShadow: look.boxShadow,
    pointerEvents: 'none',
    // Under every label it passes, above the group's own track: the group
    // becomes its own stacking context so -1 stays inside it.
    zIndex: '-1',
  });
  if (getComputedStyle(group).position === 'static') group.style.position = 'relative';
  group.style.isolation = 'isolate';
  group.prepend(ghost);
  to.classList.add('glide-target');

  const offset = (rect: DOMRect) => `translate(${rect.left - box.left + group.scrollLeft - group.clientLeft}px, ${rect.top - box.top + group.scrollTop - group.clientTop}px)`;
  const { easing, ms } = springEasing(SPRINGS.snappy);
  const motion = ghost.animate(
    [
      { transform: offset(start), width: `${start.width}px`, height: `${start.height}px` },
      { transform: offset(end), width: `${end.width}px`, height: `${end.height}px` },
    ],
    { duration: ms, easing },
  );
  const finish = () => {
    ghost.remove();
    to.classList.remove('glide-target');
  };
  motion.onfinish = finish;
  motion.oncancel = finish;
}

const ITEMS = 'button, a, [role="tab"], [role="radio"]';

/** The items of a group, in order: only its own, not those of a group nested inside it. */
function itemsOf(group: HTMLElement) {
  return [...group.querySelectorAll<HTMLElement>(ITEMS)].filter((item) => item.parentElement?.closest(GROUPS) === group);
}

/** What makes two renders of a group the same control: its label, else its classes. */
function keyOf(group: HTMLElement) {
  return group.getAttribute('aria-label') ?? group.className;
}

/**
 * Watches every group for its selection moving, and glides it. Two ways the
 * selection moves: the same group changes which item is marked (the tab
 * bar), or the screen redraws and a new copy of the group arrives with a
 * different item marked (Money's Spending | Investments is drawn by each
 * view). For the second, the last selected position of each group is kept by
 * key and the glide starts from that position in the new copy.
 */
function watchSelection() {
  const lastIndex = new Map<string, number>();
  const remember = (group: HTMLElement) => {
    const index = itemsOf(group).findIndex(isSelected);
    if (index >= 0) lastIndex.set(keyOf(group), index);
  };
  document.querySelectorAll<HTMLElement>(GROUPS).forEach(remember);

  const observer = new MutationObserver((records) => {
    const lost = new Map<HTMLElement, HTMLElement>();
    const gained = new Map<HTMLElement, HTMLElement>();
    const arrived = new Set<HTMLElement>();
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches(GROUPS)) arrived.add(node);
          node.querySelectorAll<HTMLElement>(GROUPS).forEach((group) => arrived.add(group));
        }
        continue;
      }
      const item = record.target as HTMLElement;
      // The item itself (a button, link, tab or radio), not something inside it.
      if (!item.matches(ITEMS)) continue;
      const group = item.parentElement?.closest<HTMLElement>(GROUPS);
      if (!group) continue;
      const was = record.oldValue ?? '';
      const before = record.attributeName === 'class' ? /(^|\s)active(\s|$)/.test(was) : was === 'true' || was === 'page';
      const now = isSelected(item);
      if (before && !now) lost.set(group, item);
      if (!before && now) gained.set(group, item);
    }
    const moving = !still();
    for (const [group, to] of gained) {
      const from = lost.get(group);
      if (from && moving) glide(group, from, to);
      remember(group);
    }
    for (const group of arrived) {
      const items = itemsOf(group);
      const index = items.findIndex(isSelected);
      const previous = lastIndex.get(keyOf(group));
      if (moving && index >= 0 && previous !== undefined && previous !== index && items[previous]) glide(group, items[previous], items[index]);
      remember(group);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: WATCHED });
  return () => observer.disconnect();
}

/** Plays a sheet's way out: back down to the foot on a phone, smaller and fading elsewhere. */
function leave(sheet: HTMLElement, close: () => void) {
  if (still()) return close();
  const { easing, ms } = springEasing(SPRINGS.smooth);
  const current = getComputedStyle(sheet).transform;
  const from = current === 'none' ? 'translate3d(0, 0, 0)' : current;
  const desktop = !phone();
  const towardsButton = sheet.matches('.talk-sheet') && !desktop;
  let to = 'translate3d(0, 100%, 0)';
  // Back into the button it grew out of (its transform-origin, in motion.css).
  if (towardsButton) to = 'scale(.2)';
  if (desktop) to = sheet.matches('.talk-sheet') ? 'translate3d(24px, 0, 0)' : 'scale(.96)';
  const fade = towardsButton || desktop;
  sheet.style.animation = 'none';
  const motion = sheet.animate(
    [
      { transform: from, opacity: 1 },
      { transform: to, opacity: fade ? 0 : 1 },
    ],
    // Exits are quicker than entrances: the sheet is already on its way.
    { duration: Math.round(ms * 0.6), easing, fill: 'forwards' },
  );
  const done = () => {
    close();
    // If closing didn't take the sheet away, it must not stay invisible.
    requestAnimationFrame(() => {
      if (!sheet.isConnected) return;
      motion.cancel();
      sheet.style.animation = '';
    });
  };
  motion.onfinish = done;
}

/**
 * A Close tapped with a pointer plays the exit first, then clicks again.
 * That second click, like any made with the keyboard, has detail 0 and goes
 * straight through: keyboard closes never animate.
 */
function watchCloses() {
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0 || still()) return;
    const target = event.target as Element | null;
    for (const { sheet: sheetSelector, close } of SHEETS) {
      const button = target?.closest<HTMLElement>(close);
      const sheet = button?.closest<HTMLElement>(sheetSelector);
      if (!button || !sheet) continue;
      event.preventDefault();
      event.stopPropagation();
      leave(sheet, () => button.click());
      return;
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

/** Drag a sheet down by its top bar to close it, on a phone. */
function watchDrags() {
  const onDown = (event: PointerEvent) => {
    if (!phone() || still() || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('button, a, input, textarea, select')) return;
    const match = SHEETS.find(({ sheet, handle }) => target?.closest(handle)?.closest(sheet));
    if (!match) return;
    const sheet = target!.closest<HTMLElement>(match.sheet)!;
    const close = sheet.querySelector<HTMLElement>(match.close);
    if (!close) return;

    const startY = event.clientY;
    const height = sheet.getBoundingClientRect().height;
    const history: Array<{ y: number; t: number }> = [];
    let dragging = false;
    let offset = 0;

    const move = (moved: PointerEvent) => {
      const dy = moved.clientY - startY;
      // ~10px before committing, so a tap on the bar stays a tap.
      if (!dragging) {
        if (Math.abs(dy) < 10) return;
        dragging = true;
        sheet.setPointerCapture(event.pointerId);
        sheet.style.animation = 'none';
      }
      offset = dy > 0 ? dy : rubberband(dy, height);
      sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
      history.push({ y: moved.clientY, t: moved.timeStamp });
      while (history.length > 2 && moved.timeStamp - history[0].t > 100) history.shift();
    };

    const up = () => {
      sheet.removeEventListener('pointermove', move);
      sheet.removeEventListener('pointerup', up);
      sheet.removeEventListener('pointercancel', up);
      if (!dragging) return;
      const first = history[0];
      const last = history.at(-1);
      const seconds = first && last ? (last.t - first.t) / 1000 : 0;
      const velocity = seconds > 0 ? (last!.y - first!.y) / seconds : 0;
      // Where the flick would come to rest decides, not where the finger let go.
      const goes = offset + project(velocity) > height * 0.35 && velocity > -200;
      const target = goes ? height : 0;
      animateSpring(offset, target, goes ? SPRINGS.smooth : SPRINGS.bouncy, {
        velocity,
        onFrame: (value) => { sheet.style.transform = `translate3d(0, ${value}px, 0)`; },
        onDone: () => {
          if (goes) {
            close.click();
            return;
          }
          sheet.style.transform = '';
        },
      });
    };

    sheet.addEventListener('pointermove', move);
    sheet.addEventListener('pointerup', up);
    sheet.addEventListener('pointercancel', up);
  };
  document.addEventListener('pointerdown', onDown);
  return () => document.removeEventListener('pointerdown', onDown);
}

export function MotionRuntime() {
  useEffect(() => {
    const stops = [watchSelection(), watchCloses(), watchDrags()];
    return () => stops.forEach((stop) => stop());
  }, []);
  return null;
}
