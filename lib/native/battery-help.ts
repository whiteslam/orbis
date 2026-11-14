// How to keep Orbis running on each phone maker's Android, for the "Keep Orbis
// running" row in Settings → Phone access. Many makers stop background apps
// beyond what stock Android does, and each hides the switch in its own place.

export type BatteryHelp = { brand: string; steps: string[] };

const SAMSUNG: BatteryHelp = {
  brand: 'Samsung',
  steps: [
    'Tap Open app info, then Battery.',
    'Choose Unrestricted.',
    'In Settings → Battery → Background usage limits, make sure Orbis isn’t under Sleeping apps or Deep sleeping apps.',
  ],
};

const XIAOMI: BatteryHelp = {
  brand: 'Xiaomi',
  steps: [
    'Tap Open app info and turn on Autostart.',
    'Tap Battery saver (or Battery) and choose No restrictions.',
    'In recent apps, press and hold Orbis and tap the lock, so clearing recents leaves it running.',
  ],
};

const OPPO: BatteryHelp = {
  brand: 'Oppo',
  steps: [
    'Tap Open app info, then Battery usage.',
    'Turn on Allow background activity and Allow auto launch.',
    'In recent apps, lock Orbis so clearing recents leaves it running.',
  ],
};

const VIVO: BatteryHelp = {
  brand: 'Vivo',
  steps: [
    'Tap Open battery settings, then Background power consumption management.',
    'Find Orbis and choose Allow background activity.',
    'Tap Open app info and turn on Autostart, if your phone shows it.',
  ],
};

const ONEPLUS: BatteryHelp = {
  brand: 'OnePlus',
  steps: [
    'Tap Open app info, then Battery usage.',
    'Turn on Allow background activity, and choose Don’t optimise if it is offered.',
    'In recent apps, lock Orbis so clearing recents leaves it running.',
  ],
};

const DEFAULT: BatteryHelp = {
  brand: 'Android',
  steps: [
    'Tap Open battery settings and find Orbis in the list.',
    'Choose Unrestricted, or Don’t optimise.',
  ],
};

// A Map, so a maker name like "constructor" can't reach Object.prototype.
const BY_MAKER: Map<string, BatteryHelp> = new Map([
  ['samsung', SAMSUNG],
  ['xiaomi', XIAOMI],
  ['redmi', XIAOMI],
  ['poco', XIAOMI],
  ['oppo', OPPO],
  ['realme', OPPO],
  ['vivo', VIVO],
  ['iqoo', VIVO],
  ['oneplus', ONEPLUS],
]);

/** The steps for `manufacturer` (Build.MANUFACTURER, any case), or the stock Android ones. */
export function batteryHelp(manufacturer: string): BatteryHelp {
  return BY_MAKER.get(manufacturer.trim().toLowerCase()) ?? DEFAULT;
}
