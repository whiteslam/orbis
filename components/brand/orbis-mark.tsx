import Image from 'next/image';

// The Orbis app icon, used as the brand mark wherever the UI shows the logo.
export function OrbisMark({ size = 42, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/orbis-mark.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={['orbis-mark', className].filter(Boolean).join(' ')}
      priority
    />
  );
}
