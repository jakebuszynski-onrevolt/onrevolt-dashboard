'use client';
import NextLink, { LinkProps as NextLinkProps } from 'next/link';
import {
  CSSProperties,
  ComponentProps,
  PropsWithChildren,
  useMemo,
} from 'react';

export type NavLinkProps = NextLinkProps &
  PropsWithChildren & {
    styles?: CSSProperties;
    borderRadius?: ComponentProps<typeof NextLink>['style']['borderRadius'];
  };

function NavLink({ children, styles, borderRadius, ...props }: NavLinkProps) {
  const memoizedStyles = useMemo(
    () => ({
      borderRadius: borderRadius || 0,
      ...styles,
    }),
    [borderRadius, styles],
  );

  return (
    <NextLink style={memoizedStyles} {...props}>
      {children}
    </NextLink>
  );
}

export default NavLink;
