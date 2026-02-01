'use client';

import React from 'react';
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
  SimpleGrid,
  Text,
  useColorModeValue,
  useToast,
} from '@chakra-ui/react';
import Link from 'components/link/Link';
import illustration from '/public/img/auth/auth.png';
import { HSeparator } from 'components/separator/Separator';
import DefaultAuth from '../../../components/auth/variants/DefaultAuthLayout/page';
import { FcGoogle } from 'react-icons/fc';
import { MdOutlineRemoveRedEye } from 'react-icons/md';
import { RiEyeCloseLine } from 'react-icons/ri';
import { useRouter } from 'next/navigation';
import { apiPath } from '../../../lib/basePath';

function SignUp() {
  // colors
  const textColor = useColorModeValue('navy.700', 'white');
  const textColorSecondary = 'gray.400';
  const textColorDetails = useColorModeValue('navy.700', 'secondaryGray.600');
  const textColorBrand = useColorModeValue('brand.500', 'white');
  const brandStars = useColorModeValue('brand.500', 'brand.400');
  const googleBg = useColorModeValue('secondaryGray.300', 'whiteAlpha.200');
  const googleText = useColorModeValue('navy.700', 'white');
  const googleHover = useColorModeValue({ bg: 'gray.200' }, { bg: 'whiteAlpha.300' });
  const googleActive = useColorModeValue({ bg: 'secondaryGray.300' }, { bg: 'whiteAlpha.200' });

  // UI state
  const [showPwd, setShowPwd] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  // form state
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [sendEmail, setSendEmail] = React.useState(true);

  const toast = useToast();
  const router = useRouter();

  // stałe id — dzięki temu nie będzie duplikatów
  const ids = {
    first: 'signup-first-name',
    last: 'signup-last-name',
    username: 'signup-username',
    email: 'signup-email',
    password: 'signup-password',
    sendEmail: 'signup-send-email',
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName || !lastName || !username || !email || !password) {
      toast({ status: 'warning', title: 'Missing data', description: 'Please fill all required fields.' });
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(apiPath('/api/auth/sign-up'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstname: firstName,
          lastname: lastName,
          username,
          email,
          password,
          sendEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // jeśli backend zwróci 409 (duplikat), pokaż ładny komunikat
        if (res.status === 409 && data?.error) {
          throw new Error(data.error);
        }
        throw new Error(data?.error || 'Registration failed');
      }

      toast({ status: 'success', title: 'Account created' });
      router.push('/auth/sign-in');
    } catch (err: any) {
      toast({
        status: 'error',
        title: 'Cannot create account',
        description: String(err?.message ?? err),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <DefaultAuth illustrationBackground={illustration?.src}>
      <Flex
        as="form"
        onSubmit={handleSubmit}
        w="100%"
        maxW="max-content"
        mx={{ base: 'auto', lg: '0px' }}
        me="auto"
        h="100%"
        justifyContent="center"
        mb={{ base: '30px', md: '60px' }}
        px={{ base: '25px', md: '0px' }}
        mt={{ base: '40px', md: '8vh' }}
        flexDirection="column"
      >
        <Box me="auto">
          <Heading color={textColor} fontSize={{ base: '34px', lg: '36px' }} mb="10px">
            Register Seller
          </Heading>
          <Text mb="36px" ms="4px" color={textColorSecondary} fontWeight="400" fontSize="md">
            Enter email and password to sign up!
          </Text>
        </Box>

        <Flex
          zIndex="2"
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
            onClick={() => toast({ status: 'info', title: 'Google Sign-in', description: 'Coming soon.' })}
          >
            <Icon as={FcGoogle} w="20px" h="20px" me="10px" />
            Sign up with Google
          </Button>

          <Flex align="center" mb="25px">
            <HSeparator />
            <Text color={textColorSecondary} mx="14px">
              or
            </Text>
            <HSeparator />
          </Flex>

          <FormControl>
            <SimpleGrid columns={{ base: 1, md: 2 }} gap={{ sm: '10px', md: '26px' }}>
              <Flex direction="column">
                <FormLabel htmlFor={ids.first} display="flex" ms="4px" fontSize="sm" fontWeight="500" color={textColor} mb="8px">
                  First name<Text color={brandStars}>*</Text>
                </FormLabel>
                <Input
                  id={ids.first}
                  name="firstname"
                  isRequired
                  fontSize="sm"
                  ms={{ base: '0px', md: '4px' }}
                  placeholder="First name"
                  variant="auth"
                  mb="24px"
                  size="lg"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Flex>

              <Flex direction="column">
                <FormLabel htmlFor={ids.last} display="flex" ms="4px" fontSize="sm" fontWeight="500" color={textColor} mb="8px">
                  Last name<Text color={brandStars}>*</Text>
                </FormLabel>
                <Input
                  id={ids.last}
                  name="lastname"
                  isRequired
                  variant="auth"
                  fontSize="sm"
                  placeholder="Last name"
                  mb="24px"
                  size="lg"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Flex>
            </SimpleGrid>

            <FormLabel htmlFor={ids.username} display="flex" ms="4px" fontSize="sm" fontWeight="500" color={textColor} mb="8px">
              Username<Text color={brandStars}>*</Text>
            </FormLabel>
            <Input
              id={ids.username}
              name="username"
              isRequired
              variant="auth"
              fontSize="sm"
              placeholder="username"
              mb="24px"
              size="lg"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />

            <FormLabel htmlFor={ids.email} display="flex" ms="4px" fontSize="sm" fontWeight="500" color={textColor} mb="8px">
              Email<Text color={brandStars}>*</Text>
            </FormLabel>
            <Input
              id={ids.email}
              name="email"
              isRequired
              variant="auth"
              fontSize="sm"
              type="email"
              placeholder="mail@company.com"
              mb="24px"
              size="lg"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <FormLabel htmlFor={ids.password} ms="4px" fontSize="sm" fontWeight="500" color={textColor} display="flex">
              Password<Text color={brandStars}>*</Text>
            </FormLabel>
            <InputGroup size="md">
              <Input
                id={ids.password}
                name="password"
                isRequired
                variant="auth"
                fontSize="sm"
                ms={{ base: '0px', md: '4px' }}
                placeholder="Min. 8 characters"
                mb="24px"
                size="lg"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <InputRightElement display="flex" alignItems="center" mt="4px">
                <Icon
                  color={textColorSecondary}
                  _hover={{ cursor: 'pointer' }}
                  as={showPwd ? RiEyeCloseLine : MdOutlineRemoveRedEye}
                  onClick={() => setShowPwd((s) => !s)}
                />
              </InputRightElement>
            </InputGroup>

            <Flex justifyContent="space-between" align="center" mb="24px">
              <FormControl display="flex" alignItems="start">
                <Checkbox
                  id={ids.sendEmail}
                  name="sendEmail"
                  colorScheme="brandScheme"
                  me="10px"
                  mt="3px"
                  isChecked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                />
                <FormLabel htmlFor={ids.sendEmail} mb="0" fontWeight="normal" color={textColor} fontSize="sm">
                  Send welcome e-mail after registration
                </FormLabel>
              </FormControl>
            </Flex>

            <Button
              type="submit"
              variant="brand"
              fontSize="14px"
              fontWeight="500"
              w="100%"
              h="50"
              mb="24px"
              isLoading={loading}
              loadingText="Creating…"
            >
              Create my account
            </Button>
          </FormControl>

          <Flex flexDirection="column" justifyContent="center" alignItems="start" maxW="100%" mt="0px">
            <Text color={textColorDetails} fontWeight="400" fontSize="sm">
              Already a member?
              <Link href="/auth/sign-in">
                <Text color={textColorBrand} as="span" ms="5px" fontWeight="500">
                  Sign in
                </Text>
              </Link>
            </Text>
          </Flex>
        </Flex>
      </Flex>
    </DefaultAuth>
  );
}

export default SignUp;
