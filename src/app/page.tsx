'use client';
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

// Chakra imports
import {
  Badge,
  Box,
  Button,
  Flex,
  SimpleGrid,
  Stack,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
// Custom components
import Card from 'components/card/Card';
import { Image } from 'components/image/Image';
import * as d3 from 'd3';

// Assets
import deloitteLogo from '/public/svg/deloitte-logo.svg';
import georgiaLogo from '/public/svg/georgia-logo.svg';
import googleLogo from '/public/svg/google-logo.svg';
import microsoftLogo from '/public/svg/microsoft-logo.svg';
import msnLogo from '/public/svg/msn-logo.svg';
import zohoLogo from '/public/svg/zoho-logo.svg';
// Custom components
import PricingLayout from '../components/auth/variants/PricingAuthLayout/page';
import { useState, useEffect, useRef } from 'react';
import Pack from 'components/admin/main/others/pricing/Pack';
import Layout from 'app/auth/layout';

function Pricing() {
  useEffect(() => {
    d3.select('#warstwa_kulki').selectAll('image').clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone().clone();
    const kulkiNiebieskie = d3.select('#warstwa_kulki').selectAll('#kulka_niebieska');
    const kulkiZolte = d3.select('#warstwa_kulki').selectAll('#kulka_zolta');
    const kulkiZielone = d3.select('#warstwa_kulki').selectAll('#kulka_zielona');
    const kulkiZielone2 = d3.select('#warstwa_kulki').selectAll('#kulka_zielona2');
    const kulkiFioletowe = d3.select('#warstwa_kulki').selectAll('#kulka_fioletowa');
    const kulkiFioletowe2 = d3.select('#warstwa_kulki').selectAll('#kulka_fioletowa2');
    const sciezka_fioletowa = d3.select('#sciezka_fioletowa');
    const sciezka_fioletowa2 = d3.select('#sciezka_fioletowa2');
    const sciezka_fioletowa3 = d3.select('#sciezka_fioletowa3');
    const sciezka_fioletowa4 = d3.select('#sciezka_fioletowa4');
    const sciezka_fioletowa5 = d3.select('#sciezka_fioletowa5');
    const sciezka_zolta = d3.select('#sciezka_zolta');
    const sciezka_czerwona = d3.select('#sciezka_czerwona');
    const sciezka_zielona = d3.select('#sciezka_zielona');
    const translateAlong = (path, dir) => {
      var l = path.getTotalLength();
      return function (d, i, a) {
        return function (t) {
          var p = path.getPointAtLength(Math.abs(t - dir) * l);
          var px = p.x - 24;
          var py = p.y - 24;
          return "translate(" + px + "," + py + ")";
        };
      };
    }
    const animation = (node, index, delay, gap, pathNode, dir, speed) => {
      node.transition()
        .delay(index * gap + delay)
        .duration(27000 * speed)
        .ease(d3.easeLinear)
        .attrTween("transform", translateAlong(pathNode, dir));
      // .on("end", animation(node,index));
    }
    const mainAnimation = () => {
      kulkiNiebieskie.each(function (d, i) {
        if (i < 12) {
          animation(d3.select(this), i, 6350, 2250, sciezka_fioletowa4.node(), 1, 0.72);
        }
      });
      kulkiZolte.each(function (d, i) {
        if (i < 12) {
          animation(d3.select(this), i, 0, 2250, sciezka_czerwona.node(), 0, 1);
        }
      });
      kulkiFioletowe.each(function (d, i) {
        if (i < 7) {
          animation(d3.select(this), i, 0, 3750, sciezka_zielona.node(), 0, 0.6);
        }
      });
      kulkiZielone.each(function (d, i) {
        if (i < 8) {
          animation(d3.select(this), i, 0, 4500, sciezka_zolta.node(), 1, 0.75);
        }
      });
      kulkiZielone2.each(function (d, i) {
        if (i < 10) {
          animation(d3.select(this), i, 8750, 2750, sciezka_fioletowa2.node(), 0, 0.75);
        }
      });
      kulkiFioletowe2.each(function (d, i) {
        animation(d3.select(this), i, 22000, 1000, sciezka_fioletowa3.node(), 0, 0.45);
      });
      setTimeout(mainAnimation, 27000);
    }
    mainAnimation();
  }, []);

  const textColor = useColorModeValue('secondaryGray.900', 'white');
  return (
    <Layout>
      <Flex
        position="absolute"
        top={0}
        right={0}
        bottom={0}
        zIndex={0}
        left={0}
        overflow="hidden"
      >
        <svg viewBox="0 0 3453.12 2160" width="105%" style={{ position: 'absolute', top: 0, left: "38%", right: 0, bottom: 0, zIndex: 0, transform: "translate(-40%, -10%)" }}>

          <g id="Warstwa_4">
            <image width="3840" height="2402" transform="scale(.9)" href="/img/onrevolt/aniamcja_warstwa_3-min.png" />
          </g>
          <g id="warstwa_kulki">
            <image id="kulka_fioletowa" width="48" height="48" transform="scale(.85)" href="/img/onrevolt/kulki_fiolet.png" />
            <image id="kulka_fioletowa2" width="48" height="48" transform="scale(.85)" href="/img/onrevolt/kulki_fiolet.png" />
            <image id="kulka_zolta" width="48" height="48" transform="scale(.85)" href="/img/onrevolt/kulki_zolta.png" />
            <image id="kulka_niebieska" width="48" height="48" transform="scale(.85)" href="/img/onrevolt/kulki_niebieska.png" />
            <image id="kulka_zielona" width="48" height="48" transform="scale(.85)" href="/img/onrevolt/kulki_zielona.png" />
            <image id="kulka_zielona2" width="48" height="48" transform="scale(.85)" href="/img/onrevolt/kulki_zielona.png" />
          </g>
          <g id="Warstwa_1">
            <path
              id="sciezka_fioletowa"
              style={{
                fill: "none",
                stroke: "none",//"#a259e6", //fioletowy
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              d="M2165.16,1612.96l-663.71-383.11.13-.13c-30.69-17.74-30.69-46.51,0-64.25l-.13.15,57.02-33.02h.01c30.69-17.73,30.69-46.5,0-64.24h-.01s-347.1-200.31-347.1-200.31v-.15c-30.68-17.74-80.44-17.74-111.13,0l-.13.15-31.49,18.17v-.13c-30.68,17.74-80.44,17.74-111.13,0l-.13.13-229.6-132.62"
            />
            <path
              id="sciezka_zolta"
              style={{
                fill: "none",
                stroke: "none",//"#ffe066", // żółty
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              d="M989.82,1846.09l706.82-408.14.17-.13c10.21-5.93,26.77-5.93,36.98,0l-.11.13,401.27,231.62"
            />
            <path
              id="sciezka_czerwona"
              style={{
                fill: "none",
                stroke: "none",//"#ff5c5c", // czerwony
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              d="M2045.41,821.85l266.5,153.85-.09-.03c51.17,29.55,51.17,77.47,0,107.02l.09.11-486.11,280.51h.17c-4.92,2.87-7.68,6.75-7.66,10.79.02,4.04,2.81,7.91,7.75,10.76l-.12-.04,428.31,244.94-30.73,16.9-722.06-416.79.13-.13c-30.69-17.74-30.69-46.51,0-64.25l-.13.15,57.02-33.02h.01c30.69-17.73,30.69-46.5,0-64.24h-.01s-143.54-82.83-143.54-82.83"
            />
            <line
              id="sciezka_zielona"
              style={{
                fill: "none",
                stroke: "none",//"#a259e6", // zielony
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              x1="667"
              y1="788.7"
              x2="1212.11"
              y2="1103.43"
            />
            <line
              id="sciezka_fioletowa2"
              style={{
                fill: "none",
                stroke: "none",//"#4ecb71", // fioletowy
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              x1="1212.11"
              y1="1103.43"
              x2="2149.12"
              y2="1644.43"
            />
            <path
              id="sciezka_fioletowa3"
              style={{
                fill: "none",
                stroke: "none",//"#ff59e6", // fioletowy
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              d="M1414.93,985.53l-203.56-117.48v-.15c-30.68-17.74-80.44-17.74-111.13,0l-.13.15-31.49,18.17v-.13c-30.68,17.74-80.44,17.74-111.13,0l-.13.13-229.6-132.62"
            />
            <path
              id="sciezka_fioletowa4"
              style={{
                fill: "none",
                stroke: "none",//"#a2ffe6", // fioletowy
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              d="M1414.63,985.36l143.83,83.01h.01c30.69,17.73,30.69,46.5,0,64.24h-.01s-57.02,33.01-57.02,33.01l.13-.15c-30.69,17.74-30.69,46.51,0,64.25l-.13.13,738.35,426.19,681.28-393.34"
            />
            <path
              id="sciezka_fioletowa5"
              style={{
                fill: "none",
                stroke: "none",//"#a259ff", // fioletowy
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "1.44px"
              }}
              d="M727.76,753.6l229.6,132.62.13-.13c30.69,17.74,80.45,17.74,111.14,0v.13s31.48-18.17,31.48-18.17l.13-.15c30.69-17.74,80.45-17.74,111.14,0v.15s203.25,117.31,203.25,117.31"
            />
          </g>
          <g id="Warstwa_2">
            <image width="3840" height="2402" transform="scale(.9)" href="/img/onrevolt/aniamcja_warstwa_1-min.png" />
          </g>
          <g id="Warstwa_0">
            <image width="800" height="1067" x="3205" y="515" transform="scale(0.8)" href="/img/onrevolt/turbina.gif" />
          </g>
          <g id="Warstwa_0">
            <image width="800" height="1067" x="3205" y="515" transform="scale(0.8)" href="/img/onrevolt/maska_cien_turbina.png" />
          </g>
          <g id="Warstwa_2">
            <image width="3840" height="2402" transform="scale(.9)" href="/img/onrevolt/aniamcja_warstwa_1-min.png" />
          </g>
        </svg>
      </Flex>
      <PricingLayout
        contentTop={{ base: '140px', md: '5vh' }}
        contentBottom={{ base: '50px', lg: 'auto' }}
      >

        <Flex
          direction="column"
          alignSelf="center"
          justifySelf="center"
          overflow="hidden"
        >

          <Flex
            direction="column"
            textAlign="left"
            justifyContent="left"
            align="left"
            mb="38px"
            
          >

            <Text
              zIndex="1"
              fontSize="38px"
              color="white"
              fontWeight="700"
              maxW="550px"
              lineHeight="52px"
            >
              Osiągnij niezależność
              energetyczną już dziś!
            </Text>
            {/* <Text
              zIndex="1"
              fontSize="md"
              color="white"
              fontWeight="normal"
              mt="10px"
              mb="26px"
              maxW="400px"
            >
              See our pricing plans for all Premium and Free products &
              templates. Try now Horizon UI Dashboard
            </Text> */}
            <Flex
              mb={{ base: '0px', '2xl': '80px' }}
              zIndex="2"
              borderRadius="60px"
              p="6px"

            >
              <Button
                variant="no-hover"
                w="215px"
                h="60px"
                fontSize="ms"
                color={'white'}
                bg={'brand.500'}
                onClick={() => { }}
                borderRadius="60px"
              >
                Skontaktuj się z nami
              </Button>
            </Flex>
            <Stack
              direction={{ sm: 'column', xl: 'row' }}
              alignItems="center"
              spacing="20px"
              mt="40px"
              mb="160px"
              marginTop="55vh"
            >
              <Pack
                title="Freelancer"
                desc="Hit the ground running."
                button="Start Free Trial"
                price={
                  <Text
                    textAlign="start"
                    w="100%"
                    color={textColor}
                    fontSize="40px"
                    fontWeight="bold"
                  >
                    $159
                    <Text
                      as="span"
                      color="secondaryGray.600"
                      fontSize="40px"
                      fontWeight="bold"
                    >
                      /mo
                    </Text>
                  </Text>
                }
                details="(Per subscriber per month)"
                benefits={[
                  'Sell on your own terms',
                  'Website, marketing tools & automations',
                  'Bandwidth & storage is included',
                  'We’ll get you onboarded',
                ]}
              />
              <Pack
                title="Company"
                desc="Power-up your business."
                button="Get started"
                highlighted={true}
                price={
                  <Text
                    textAlign="start"
                    w="max-content"
                    color={textColor}
                    fontSize="40px"
                    fontWeight="bold"
                  >
                    $189
                    <Text
                      as="span"
                      color="secondaryGray.600"
                      fontSize="40px"
                      fontWeight="bold"
                    >
                      /mo
                    </Text>
                  </Text>
                }
                details="(Per subscriber per month)"
                benefits={[
                  'Live chat & countdowns',
                  'Website, marketing tools & automations',
                  'Bandwidth & storage is included',
                  'We’ll get you onboarded',
                ]}
              />
              <Pack
                title="Freelancer"
                desc="Hit the ground running."
                button="Start Free Trial"
                price={
                  <Text color={textColor} fontSize="40px" fontWeight="bold">
                    +1 982 66 88 99
                  </Text>
                }
                details="(Available in all countries)"
                benefits={[
                  'We’ll migrate you for free',
                  'Live chat & countdowns',
                  'Bandwidth & storage is included',
                  'We’ll get you onboardedd',
                ]}
              />
            </Stack>
            <Card flexDirection="column" w="100%">
              <Box w="100%" position="relative" pb="55%" /* 16:9 aspect ratio */>
                <Image
                  src="/img/onrevolt/schemat.svg"
                  alt="schemat"
                  position="absolute"
                  top="0"
                  left="0"
                  width="100%"
                  height="100%"
                  objectFit="contain"
                />
              </Box>
              </Card>
            <Flex direction="column" mb="160px" justify="center" align="center">

              <SimpleGrid
                columns={{ sm: 2, md: 3, lg: 6 }}
                spacingX={{ sm: '65px', lg: '40px', xl: '65px' }}
                spacingY={{ sm: '30px' }}
              >
                <Image
                  src={googleLogo}
                  alignSelf="center"
                  justifySelf="center"
                  alt=""
                />
                <Image
                  src={msnLogo}
                  alignSelf="center"
                  justifySelf="center"
                  alt=""
                />
                <Image
                  src={microsoftLogo}
                  alignSelf="center"
                  justifySelf="center"
                  alt=""
                />
                <Image
                  src={zohoLogo}
                  alignSelf="center"
                  justifySelf="center"
                  alt=""
                />
                <Image
                  src={georgiaLogo}
                  alignSelf="center"
                  justifySelf="center"
                  alt=""
                />
                <Image
                  src={deloitteLogo}
                  alignSelf="center"
                  justifySelf="center"
                  alt=""
                />
              </SimpleGrid>
            </Flex>
            {/* <Text color={textColor} fontWeight="bold" fontSize="34px" mb="60px">
              Frequently Asked Questions
            </Text> */}
            <SimpleGrid
              columns={{ md: 1, lg: 2 }}
              spacing="60px"
              maxW="1170px"
              mx="auto"
            >
              <Box>
                <Box mb="60px">
                  <Text
                    textAlign="start"
                    color={textColor}
                    fontWeight="500"
                    fontSize="2xl"
                    mb="12px"
                  >
                    Are the images, fonts, and icons free to use?
                  </Text>
                  <Text
                    textAlign="start"
                    color="secondaryGray.600"
                    fontWeight="500"
                    fontSize="md"
                  >
                    These products are not Wordpress themes, however, they can
                    be integrated in Wordpress by an experienced web developer.
                  </Text>
                </Box>
                <Box mb="60px">
                  <Text
                    textAlign="start"
                    color={textColor}
                    fontWeight="500"
                    fontSize="2xl"
                    mb="12px"
                  >
                    Do these themes work with Wordpress?
                  </Text>
                  <Text
                    textAlign="start"
                    color="secondaryGray.600"
                    fontWeight="500"
                    fontSize="md"
                  >
                    These products are not Wordpress themes, however, they can
                    be integrated in Wordpress by an experienced web developer.
                  </Text>
                </Box>
                <Box mb="60px">
                  <Text
                    textAlign="start"
                    color={textColor}
                    fontWeight="500"
                    fontSize="2xl"
                    mb="12px"
                  >
                    What does the Included Documentation feature refer to?
                  </Text>
                  <Text
                    textAlign="start"
                    color="secondaryGray.600"
                    fontWeight="500"
                    fontSize="md"
                  >
                    It means that each theme within the Exclusive Digital Bundle
                    promotion has a thorough and up to date documentation on how
                    to get started with the product and each components and
                    plugin is properly explained.
                  </Text>
                </Box>
              </Box>
              <Box>
                <Box mb="60px">
                  <Text
                    textAlign="start"
                    color={textColor}
                    fontWeight="500"
                    fontSize="2xl"
                    mb="12px"
                  >
                    Are the themes available with only classic CSS and without
                    Sass as well?
                  </Text>
                  <Text
                    textAlign="start"
                    color="secondaryGray.600"
                    fontWeight="500"
                    fontSize="md"
                  >
                    Yes, they are. Each theme has a html&css folder which
                    contains the theme with classic HTML, CSS, and Javascript
                    files.
                  </Text>
                </Box>
                <Box mb="60px">
                  <Text
                    textAlign="start"
                    color={textColor}
                    fontWeight="500"
                    fontSize="2xl"
                    mb="12px"
                  >
                    If I purchased a Freelancer/Company License, how can I
                    upgrade to the Company/Enterprise License?
                  </Text>
                  <Text
                    textAlign="start"
                    color="secondaryGray.600"
                    fontWeight="500"
                    fontSize="md"
                  >
                    In case you have already purchased a license, but you want
                    to upgrade, you can just send us a message using the contact
                    page and we will send you a discount code so you will only
                    pay the difference for the upgrade.
                  </Text>
                </Box>
                <Box mb="60px">
                  <Text
                    textAlign="start"
                    color={textColor}
                    fontWeight="500"
                    fontSize="2xl"
                    mb="12px"
                  >
                    What is the difference on Free and PRO products?
                  </Text>
                  <Text
                    textAlign="start"
                    color="secondaryGray.600"
                    fontWeight="500"
                    fontSize="md"
                  >
                    The differences between the Free and Pro products consists
                    of the number of components, plugins, sections, pages in
                    each
                  </Text>
                </Box>
              </Box>
            </SimpleGrid>
          </Flex>
        </Flex>
      </PricingLayout>
    </Layout>
  );
}

export default Pricing;
