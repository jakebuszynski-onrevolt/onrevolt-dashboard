'use client';

/*!
  Horizon UI Dashboard PRO – Sign In (custom DB auth)
*/

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Icon,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  useColorModeValue,
  useToast,
} from '@chakra-ui/react';
import { HSeparator } from 'components/separator/Separator';
import DefaultAuth from '../../../components/auth/variants/DefaultAuthLayout/page';
import illustration from '/public/img/auth/auth.png';
import { FcGoogle } from 'react-icons/fc';
import { MdOutlineRemoveRedEye } from 'react-icons/md';
import { RiEyeCloseLine } from 'react-icons/ri';
import NavLink from 'components/link/NavLink';
import { apiPath } from '../../../lib/basePath';

export default function SignIn() {
  const router = useRouter();
  const toast = useToast();

  // Chakra colors
  const textColor = useColorModeValue('navy.700', 'white');
  const textColorSecondary = 'gray.400';
  const textColorDetails = useColorModeValue('navy.700', 'secondaryGray.600');
  const textColorBrand = useColorModeValue('brand.500', 'white');
  const brandStars = useColorModeValue('brand.500', 'brand.400');
  const googleBg = useColorModeValue('secondaryGray.300', 'whiteAlpha.200');
  const googleText = useColorModeValue('navy.700', 'white');
  const googleHover = useColorModeValue({ bg: 'gray.200' }, { bg: 'whiteAlpha.300' });
  const googleActive = useColorModeValue({ bg: 'secondaryGray.300' }, { bg: 'whiteAlpha.200' });

  // Local state
  const [show, setShow] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [identifier, setIdentifier] = React.useState(''); // email lub username
  const [password, setPassword] = React.useState('');

  const handleClick = () => setShow(!show);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier || !password) {
      toast({ status: 'warning', title: 'Uzupełnij dane', description: 'Podaj email/username i hasło.' });
      return;
    }
    try {
      setLoading(true);
      const r = await fetch(apiPath('/api/auth/sign-in'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg || 'Login failed');
      }
      // OK -> redirect do Users Overview
      router.replace('/admin/main/users/users-overview');
    } catch (err: any) {
      toast({
        status: 'error',
        title: 'Logowanie nieudane',
        description: err?.message?.slice(0, 300) || 'Błędne dane logowania.',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <DefaultAuth illustrationBackground={illustration?.src}>
      <Flex
        maxW={{ base: '100%', md: 'max-content' }}
        w="100%"
        mx={{ base: 'auto', lg: '0px' }}
        me="auto"
        h="100%"
        alignItems="start"
        justifyContent="center"
        mb={{ base: '30px', md: '60px' }}
        px={{ base: '25px', md: '0px' }}
        mt={{ base: '40px', md: '14vh' }}
        flexDirection="column"
      >
        <Box me="auto">
          <Heading color={textColor} fontSize="36px" mb="10px">
            Sign In
          </Heading>
          <Text mb="36px" ms="4px" color={textColorSecondary} fontWeight="400" fontSize="md">
            Enter your email and password to sign in!
          </Text>
        </Box>

        <Flex
          zIndex="2"
          as="form"
          onSubmit={onSubmit}
          direction="column"
          w={{ base: '100%', md: '420px' }}
          maxW="100%"
          background="transparent"
          borderRadius="15px"
          mx={{ base: 'auto', lg: 'unset' }}
          me="auto"
          mb={{ base: '20px', md: 'auto' }}
        >
          <Button
            type="button"
            fontSize="sm"
            me="0px"
            mb="26px"
            py="15px"
            h="50px"
            borderRadius="16px"
            bg={googleBg}
            color={googleText}
            fontWeight="500"
            _hover={googleHover}
            _active={googleActive}
            _focus={googleActive}
          >
            <Icon as={FcGoogle} w="20px" h="20px" me="10px" />
            Sign in with Google
          </Button>

          <Flex align="center" mb="25px">
            <HSeparator />
            <Text color="gray.400" mx="14px">
              or
            </Text>
            <HSeparator />
          </Flex>

          <FormControl>
            <FormLabel display="flex" ms="4px" fontSize="sm" fontWeight="500" color={textColor} mb="8px">
              Email or Username<Text color={brandStars}>*</Text>
            </FormLabel>
            <Input
              required
              variant="auth"
              fontSize="sm"
              type="text"
              placeholder="mail@company.com or username"
              mb="24px"
              fontWeight="500"
              size="lg"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
            />

            <FormLabel ms="4px" fontSize="sm" fontWeight="500" color={textColor} display="flex">
              Password<Text color={brandStars}>*</Text>
            </FormLabel>
            <InputGroup size="md">
              <Input
                required
                fontSize="sm"
                placeholder="Min. 8 characters"
                mb="24px"
                size="lg"
                type={show ? 'text' : 'password'}
                variant="auth"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <InputRightElement display="flex" alignItems="center" mt="4px">
                <Icon
                  color={textColorSecondary}
                  _hover={{ cursor: 'pointer' }}
                  as={show ? RiEyeCloseLine : MdOutlineRemoveRedEye}
                  onClick={handleClick}
                />
              </InputRightElement>
            </InputGroup>

            <Flex justifyContent="space-between" align="center" mb="24px">
              <FormControl display="flex" alignItems="center">
                <Checkbox id="remember-login" colorScheme="brandScheme" me="10px" />
                <FormLabel htmlFor="remember-login" mb="0" fontWeight="normal" color={textColor} fontSize="sm">
                  Keep me logged in
                </FormLabel>
              </FormControl>

              <NavLink href="/auth/forgot-password">
                <Text color={textColorBrand} fontSize="sm" w="124px" fontWeight="500">
                  Forgot password?
                </Text>
              </NavLink>
            </Flex>

            <Button
              type="submit"
              fontSize="sm"
              variant="brand"
              fontWeight="500"
              w="100%"
              h="50"
              mb="24px"
              isLoading={loading}
              loadingText="Signing in…"
            >
              Sign In
            </Button>
          </FormControl>

          <Flex flexDirection="column" justifyContent="center" alignItems="start" maxW="100%" mt="0px">
            <Text color={textColorDetails} fontWeight="400" fontSize="14px">
              Not registered yet?
              <NavLink href="/auth/sign-up">
                <Text color={textColorBrand} as="span" ms="5px" fontWeight="500">
                  Create an Account
                </Text>
              </NavLink>
            </Text>
          </Flex>
        </Flex>
      </Flex>
    </DefaultAuth>
  );
}
