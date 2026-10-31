import Image from 'next/image';

/**
 * A mood's face, drawn from Microsoft's Fluent 3D emoji (MIT licence, in
 * public/emoji/fluent/LICENSE) rather than the device's emoji font, so it looks
 * the same glossy 3D style on every device. Apple's own emoji artwork isn't
 * licensed for use outside Apple's platforms. Decorative: the mood's word is
 * always beside it or in the surrounding label.
 */
const FILES: Record<number, string> = { 1: 'rough', 2: 'low', 3: 'okay', 4: 'good', 5: 'great' };

export function MoodEmoji({ value, size = 28, className }: Readonly<{ value: number; size?: number; className?: string }>) {
  const file = FILES[value];
  if (!file) return null;
  return <Image className={['mood-emoji', className].filter(Boolean).join(' ')} src={`/emoji/fluent/${file}.png`} alt="" aria-hidden="true" width={size} height={size} draggable={false} />;
}
