'use client'
/*!
  _   _  ___  ____  ___ ________  _   _   _   _ ___   ____  ____   ___  
 | | | |/ _ \|  _ \|_ _|__  / _ \| \ | | | | | |_ _| |  _ \|  _ \ / _ \ 
 | |_| | | | | |_) || |  / / | | |  \| | | | | || |  | |_) | |_) | | | |
 |  _  | |_| |  _ < | | / /| |_| | |\  | | |_| || |  |  __/|  _ <| |_| |
 |_| |_|\___/|_| \_\___/____\___/|_| \_|  \___/|___| |_|   |_| \_\\___/ 
                                                                                                                                                                                                                                                                                                                                       
=========================================================
* Horizon UI Dashboard PRO - v1.0.0
=========================================================

* Product Page: https://www.horizon-ui.com/pro/
* Copyright 2022 Horizon UI (https://www.horizon-ui.com/)

* Designed and Coded by Simmmple

=========================================================

* The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

*/

import React from 'react';
// Chakra imports
import {
  Alert,
  AlertIcon,
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
} from '@chakra-ui/react';
import DefaultAuth from '../../../../components/auth/variants/DefaultAuthLayout/page';
// Assets
import illustration from '/public/img/auth/auth.png';
import { MdOutlineRemoveRedEye } from 'react-icons/md';
import { RiEyeCloseLine } from 'react-icons/ri';
import NavLink from 'components/link/NavLink';
import { useRouter } from 'next/navigation';

function SignIn() {
  const router = useRouter();
  // Chakra color mode
  const textColor = useColorModeValue('navy.700', 'white');
  const textColorSecondary = 'gray.400';
  const textColorDetails = useColorModeValue('navy.700', 'secondaryGray.600');
  const textColorBrand = useColorModeValue('brand.500', 'white');
  const brandStars = useColorModeValue('brand.500', 'brand.400');
  const [show, setShow] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const handleClick = () => setShow(!show);

  async function handleLogin(event: React.FormEvent<HTMLDivElement>) {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
          const response = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password }),
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
          router.push('/admin/dashboard');
      } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
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
                      Logowanie
                  </Heading>
                  <Text
                      mb="36px"
                      ms="4px"
                      color={textColorSecondary}
                      fontWeight="400"
                      fontSize="md"
                  >
                      Podaj email i hasło do panelu onRevolt.
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
                  {error ? (
                      <Alert status="error" borderRadius="12px" mb="18px">
                          <AlertIcon />
                          {error}
                      </Alert>
                  ) : null}
                  <Box as="form" onSubmit={handleLogin}>
                      <FormLabel
                          display="flex"
                          ms="4px"
                          fontSize="sm"
                          fontWeight="500"
                          color={textColor}
                          mb="8px"
                      >
                          Email<Text color={brandStars}>*</Text>
                      </FormLabel>
                      <Input
                          isRequired={true}
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          variant="auth"
                          fontSize="sm"
                          ms={{ base: '0px', md: '0px' }}
                          type="email"
                          placeholder="admin@onrevolt.com"
                          mb="24px"
                          fontWeight="500"
                          size="lg"
                      />
                      <FormLabel
                          ms="4px"
                          fontSize="sm"
                          fontWeight="500"
                          color={textColor}
                          display="flex"
                      >
                          Hasło<Text color={brandStars}>*</Text>
                      </FormLabel>
                      <InputGroup size="md">
                          <Input
                              isRequired={true}
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              fontSize="sm"
                              placeholder="Minimum 8 znaków"
                              mb="24px"
                              size="lg"
                              type={show ? 'text' : 'password'}
                              variant="auth"
                          />
                          <InputRightElement
                              display="flex"
                              alignItems="center"
                              mt="4px"
                          >
                              <Icon
                                  color={textColorSecondary}
                                  _hover={{ cursor: 'pointer' }}
                                  as={
                                      show
                                          ? RiEyeCloseLine
                                          : MdOutlineRemoveRedEye
                                  }
                                  onClick={handleClick}
                              />
                          </InputRightElement>
                      </InputGroup>
                      <Flex
                          justifyContent="space-between"
                          align="center"
                          mb="24px"
                      >
                          <FormControl display="flex" alignItems="center">
                              <Checkbox
                                  id="remember-login"
                                  colorScheme="brandScheme"
                                  me="10px"
                              />
                              <FormLabel
                                  htmlFor="remember-login"
                                  mb="0"
                                  fontWeight="normal"
                                  color={textColor}
                                  fontSize="sm"
                              >
                                  Zapamiętaj logowanie
                              </FormLabel>
                          </FormControl>
                          <NavLink href="/auth/forgot-password">
                              <Text
                                  color={textColorBrand}
                                  fontSize="sm"
                                  w="124px"
                                  fontWeight="500"
                              >
                                  Nie pamiętasz hasła?
                              </Text>
                          </NavLink>
                      </Flex>
                      <Button
                          fontSize="sm"
                          variant="brand"
                          fontWeight="500"
                          w="100%"
                          h="50"
                          mb="24px"
                          type="submit"
                          isLoading={loading}
                      >
                          Zaloguj
                      </Button>
                  </Box>
                  <Flex
                      flexDirection="column"
                      justifyContent="center"
                      alignItems="start"
                      maxW="100%"
                      mt="0px"
                  >
                      <Text
                          color={textColorDetails}
                          fontWeight="400"
                          fontSize="14px"
                      >
                          Nie masz konta?
                          <NavLink href="/auth/sign-up">
                              <Text
                                  color={textColorBrand}
                                  as="span"
                                  ms="5px"
                                  fontWeight="500"
                              >
                                  Poproś administratora o dostęp
                              </Text>
                          </NavLink>
                      </Text>
                  </Flex>
              </Flex>
          </Flex>
      </DefaultAuth>
  );
}

export default SignIn;
