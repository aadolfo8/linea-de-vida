import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent px-5 py-2 text-sm font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-map-ink text-map-paper hover:bg-map-route',
        secondary: 'bg-map-route-soft text-map-ink hover:bg-map-line',
        outline: 'border-map-line bg-transparent text-map-ink hover:bg-map-panel',
        ghost: 'text-map-ink hover:bg-map-panel',
        destructive: 'bg-map-danger text-white hover:brightness-90',
        link: 'min-h-0 rounded-none px-0 text-map-route underline-offset-4 hover:underline',
      },
      size: {
        default: '',
        sm: 'min-h-9 px-3 text-xs',
        lg: 'min-h-12 px-7 text-base',
        icon: 'size-11 min-h-0 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
