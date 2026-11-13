import type { ComponentProps } from 'react';
import { Link as RouterLink } from 'react-router';

type LinkProps = Omit<ComponentProps<typeof RouterLink>, 'to'> & { href: string };

/** A client-side link: the props of an anchor, with `href` in place of the router's `to`. */
export function Link({ href, ...props }: LinkProps) {
  return <RouterLink to={href} {...props} />;
}
