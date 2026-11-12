import type { ComponentProps } from 'react';

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent px-5 py-2 text-sm font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

const variants = {
  default: 'bg-map-ink text-map-paper hover:bg-map-route',
  outline: 'border-map-line bg-transparent text-map-ink hover:bg-map-panel',
} as const;

const sizes = { default: '', sm: 'min-h-9 px-3 text-xs' } as const;

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({ className, variant = 'default', size = 'default', ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={[base, variants[variant], sizes[size], className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
