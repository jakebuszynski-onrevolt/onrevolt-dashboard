'use client';
import { ButtonProps } from '@chakra-ui/react';
import NextLink, { LinkProps as NextLinkProps } from 'next/link';

import { Button } from '@chakra-ui/react';

type LinkProps = ButtonProps & NextLinkProps;

function Link({ href, children, ...props }: LinkProps) {
  return (
    <Button
      as={NextLink}
      href={href}
      bg="none"
      _hover={{ bg: 'none' }}
      textAlign="start"
      maxW="max-content"
      mx="unset"
      px="0px"
      h="max-content"
      {...props}
    >
      {children}
    </Button>
  );
}

export default Link;
