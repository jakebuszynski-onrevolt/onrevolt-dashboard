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
  Box,
  Button,
  Flex,
  Link,
  SimpleGrid,
  Stack,
  Text,
  useColorModeValue,
  AspectRatio,
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
import { ReflowLogo, ResourceLogo, RevolveLogo } from 'components/icons/Icons';
// Custom components
import PricingLayout from '../components/auth/variants/PricingAuthLayout/page';
import { useState, useEffect, useRef } from 'react';
import Pack from 'components/admin/main/others/pricing/Pack';
import Layout from 'app/auth/layout';
import { Widget } from '@typeform/embed-react';

function Pricing() {
  useEffect(() => {
    // const script = document.createElement("script");

    // script.src = '<script>var loadBabel = function(url, callback) {var script = document.createElement(\'script\');script.async = true;if (script.readyState) {script.onreadystatechange = function() {if (script.readyState == \'loaded\' || script.readyState == \'complete\') {script.onreadystatechange = null;callback(window, document);}};} else {script.onload = function() {callback(window, document);};}script.src = url;document.head.appendChild(script);};var getCookie = function(cname) {var objToday = new Date();var version = objToday.toISOString().split(\'T\')[0].split(\'-\').join(\'\');var name = cname + \'=\';var decodedCookie = decodeURIComponent(document.cookie);var cookieArray = decodedCookie.split(\';\');for (var i = 0; i < cookieArray.length; i++) {var cookie = cookieArray[i];cookie = cookie.trim();if (cookie.indexOf(name) == 0) {return cookie.substring(name.length, cookie.length);}}return version;};var loadWidget = function(window, document) {var __cp = {"id":"g6lg2f3gzKrPs6RJQHxU-36Xrzxtb40MAixqTB8VqKs","version":"1.1"};var cp = document.createElement(\'script\');cp.type = \'text/javascript\';cp.async = true;cp.src = "++cdn-widget.callpage.io+build+js+callpage.js".replace(/[+]/g, \'/\').replace(/[=]/g, \'.\') + \'?v=\' + getCookie(\'callpage-widget-version\');var s = document.getElementsByTagName(\'script\')[0];s.parentNode.insertBefore(cp, s);if (window.callpage) {alert(\'You could have only 1 CallPage code on your website!\');} else {window.callpage = function(method) {if (method == \'__getQueue\') {return this.methods;} else if (method) {if (typeof window.callpage.execute === \'function\') {return window.callpage.execute.apply(this, arguments);} else {(this.methods = this.methods || []).push({arguments: arguments,});}}};window.callpage.__cp = __cp;window.callpage(\'api.button.autoshow\');}};loadBabel(\'https://cdnjs.cloudflare.com/ajax/libs/babel-polyfill/6.26.0/polyfill.min.js\', function() {return loadWidget(window, document);});</script>';
    // script.async = true;

    // document.body.appendChild(script);
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
    let animationTimeout = null;
    const mainAnimation = () => {
      kulkiNiebieskie.each(function (this: SVGImageElement, d, i) {
        if (i < 12) {
          animation(d3.select(this), i, 6350, 2250, sciezka_fioletowa4.node(), 1, 0.72);
        }
      });
      kulkiZolte.each(function (this: SVGImageElement, d, i) {
        if (i < 12) {
          animation(d3.select(this), i, 0, 2250, sciezka_czerwona.node(), 0, 1);
        }
      });
      kulkiFioletowe.each(function (this: SVGImageElement, d, i) {
        if (i < 7) {
          animation(d3.select(this), i, 0, 3750, sciezka_zielona.node(), 0, 0.6);
        }
      });
      kulkiZielone.each(function (this: SVGImageElement, d, i) {
        if (i < 8) {
          animation(d3.select(this), i, 0, 4500, sciezka_zolta.node(), 1, 0.75);
        }
      });
      kulkiZielone2.each(function (this: SVGImageElement, d, i) {
        if (i < 10) {
          animation(d3.select(this), i, 8750, 2750, sciezka_fioletowa2.node(), 0, 0.75);
        }
      });
      kulkiFioletowe2.each(function (this: SVGImageElement, d, i) {
        animation(d3.select(this), i, 22000, 1000, sciezka_fioletowa3.node(), 0, 0.45);
      });
      animationTimeout=setTimeout(mainAnimation, 27000);
    }
    mainAnimation();
    // Store timeout id for animation loop
    

    // Helper to reset transforms for all kulki (each element)
    const resetKulkiTransforms = () => {
      kulkiNiebieskie.each(function(this: SVGImageElement) {
        d3.select(this).attr("transform", "translate(0,0)");
      });
      kulkiZolte.each(function(this: SVGImageElement) {
        d3.select(this).attr("transform", "translate(0,0)");
      });
      kulkiZielone.each(function(this: SVGImageElement) {
        d3.select(this).attr("transform", "translate(0,0)");
      });
      kulkiZielone2.each(function(this: SVGImageElement) {
        d3.select(this).attr("transform", "translate(0,0)");
      });
      kulkiFioletowe.each(function(this: SVGImageElement) {
        d3.select(this).attr("transform", "translate(0,0)");
      });
      kulkiFioletowe2.each(function(this: SVGImageElement) {
        d3.select(this).attr("transform", "translate(0,0)");
      });
    };

    // Helper to interrupt all transitions for kulki
    const interruptKulki = () => {
      kulkiNiebieskie.each(function(this: SVGImageElement) { d3.select(this).interrupt(); });
      kulkiZolte.each(function(this: SVGImageElement) { d3.select(this).interrupt(); });
      kulkiZielone.each(function(this: SVGImageElement) { d3.select(this).interrupt(); });
      kulkiZielone2.each(function(this: SVGImageElement) { d3.select(this).interrupt(); });
      kulkiFioletowe.each(function(this: SVGImageElement) { d3.select(this).interrupt(); });
      kulkiFioletowe2.each(function(this: SVGImageElement) { d3.select(this).interrupt(); });
    };

    // On window focus, reset animation
    const handleFocus = () => {
      if (animationTimeout) {
        clearTimeout(animationTimeout);
      }
      interruptKulki();
      resetKulkiTransforms();
      mainAnimation();
    };

    window.addEventListener('focus', handleFocus);

    // Clean up timeout on unmount (do not remove focus listener)
    return () => {
      if (animationTimeout) {
        clearTimeout(animationTimeout);
      }
    };
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
        width="100vw"
        maxWidth="100%"
        overflowX="hidden"
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
        <Image src="/img/onrevolt/background.png" overflow="hidden" alt="turbina" w="100%" h="99%" top="15vh" zIndex={-10} />
      </Flex>
      <PricingLayout
        contentTop={{ base: '140px', md: '5vh' }}
        contentBottom={{ base: '50px', lg: 'auto' }}
      >

        <Flex
          direction="column"
          alignSelf="center"
          justifySelf="center"
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
                onClick={() => { document.getElementById('form')?.scrollIntoView({ behavior: 'smooth' }) }}
                borderRadius="60px"
              >
                Skontaktuj się z nami
              </Button>
            </Flex>
            <Stack
              direction={{ sm: 'column', md: 'column', lg: 'column', xl: 'row' }}
              alignItems="top"
              spacing="20px"
              mt="40px"
              mb="60px"
              verticalAlign="top"
              marginTop={{ sm: '60px', md: '60px', lg: '80vh', xl: '80vh', '2xl': '40vw' }}
            >
              <Pack
                title={<RevolveLogo width={120} />}
                desc="Innowacyjna turbina wiatrowa 2kW"
                statement={["pokryje nawet ", <Text key="percentage" color="secondaryGray.900" as="span" fontWeight="bold" fontSize="2.5rem">50%</Text>, " Twojego rocznego zapotrzebowania na prąd!"]}
                image={"/img/onrevolt/Revolve_image.png"}
                benefits={[{
                  bold: "Gwarancja uzysku energii",
                  text: "Gwarantujemy uzysk energii obliczony na podstawie warunków wiatrowych Twojej lokalizacji."
                }, {
                  bold: "Produkcja energii już od 2,5 m/s",
                  text: "Autorski generator, profil skrzydeł i konwerter zapewniają wydajność pracy przy niskich prędkościach wiatru."
                }, {
                  bold: "Montaż bez pozwoleń",
                  text: "Dzięki wymiarom turbiny nieprzekraczającym 3 m oraz wadze 60 kg nie potrzebujesz zgód z urzędu."
                }, {
                  bold: "Idealne uzupełnienie dla PV",
                  text: "Generuje energię, gdy nie świeci słońce. Transparentne i ciche skrzydła nie rzucają cienia na panele fotowoltaiczne."
                }, {
                  bold: "Projekt realizowany w całości w Polsce",
                  text: "Lokalny projekt, krajowa produkcja i kontrola jakości na każdym etapie."
                }
                ]}
                CTA={
                  <Link display="inline-flex" alignItems="center" gap="8px" fontSize="1rem"
                    color="secondaryGray.600" justifyContent="center" flexDirection="row" mt="20px" ml="auto" mr="auto"
                    href="/img/onrevolt/Revolve.pdf" target="_blank"
                    type="application/octet-stream" download="Revolve_broszura.pdf">
                    <Image
                      src="/img/onrevolt/Download_icon.svg"
                      alt="Pobierz"
                      w="35px"
                      h="35px"
                      style={{ display: 'inline', verticalAlign: 'middle' }}
                    />
                    Pobierz broszurę informacyjną
                  </Link>
                }
              />
              <Pack
                title={<ReflowLogo width={104} />}
                desc="Centrum energetycznej niezależności"
                statement={["zmniejsza Twoje rachunki nawet o ", <Text key="percentage" color='secondaryGray.900' fontWeight="bold" as="span" fontSize="2.5rem">80%</Text>]}
                image={"/img/onrevolt/Reflow_image.png"}
                benefits={[{
                  bold: "Twój dom jako centrum energetycznej niezależności",
                  text: "System automatycznie optymalizuje Twoje zużycie prądu, umożliwia handel energią i mierzy każdą kilowatogodzinę - wszystko po to, abyś maksymalnie wykorzystał swój depozyt prosumencki."
                }, {
                  bold: "Inteligentnie. Wydajnie. Zyskownie.",
                  text: "Re:flow analizuje momenty, kiedy energia jest najtańsza, magazynuje ją w banku energii, a następnie sprzedaje energię wyprodukowaną z OZE w godzinach największej opłacalności – dzięki czemu Twój depozyt prosumencki rośnie każdego dnia."
                }, {
                  bold: "Więcej kontroli przy mniejszym wysiłku",
                  text: "Pełna automatyzacja - system sam zbiera, przechowuje i sprzedaje energię, a Ty tylko obserwujesz korzyści na dedykowanym urządzeniu, które otrzymujesz w zestawie."
                }]}
                CTA={<Button mt="20px" justifyContent="center" flexDirection="row" variant="no-hover" w="100%" h="76px" fontSize="lg" color={'white'} bg={'brand.500'} onClick={() => { document.getElementById('form')?.scrollIntoView({ behavior: 'smooth' }) }} borderRadius="17px">Sprawdź, ile możesz zaoszczędzić</Button>}
              />
              <Pack
                title={<ResourceLogo width={137} />}
                desc="Magazyn, który daje Ci niezależność"
                statement={["gromadzi ", <Text key="capacity" color="secondaryGray.900" as="span" fontWeight="bold" fontSize="2.5rem">15kWh</Text>, " energii w zasięgu Twoich potrzeb"]}
                image={"/img/onrevolt/Resource_image.png"}
                benefits={[{
                  bold: "Zaprojektowany na lata",
                  text: "Ponad 8000 cykli (22 lata codziennego użycia) z zachowaniem 80% pojemności"
                }, {
                  bold: "Bezpieczeństwo i stabilność",
                  text: "Technologia LiFePO₄ gwarantuje stabilność termiczną i chemiczną, bez ryzyka przegrzewania czy degradacji, a autorski system BMS w czasie rzeczywistym dba o balans ogniw, kontroluje temperaturę i napięcie oraz chroni przed przeciążeniem, zwarciem i głębokim rozładowaniem."
                }, {
                  bold: "Realna oszczędność i pełna integracja",
                  text: "Obniża rachunki i zwiększa zwrot z OZE, zapewnia niezależność od taryf i stały dostęp do energii. Magazynuje prąd jak oszczędności, a dzięki pełnej integracji z turbiną wiatrową i instalacją fotowoltaiczną staje się centralnym elementem domowego ekosystemu energetycznego."
                }]}
                CTA={
                  <Link display="inline-flex" alignItems="center" gap="8px" fontSize="1rem"
                    color="secondaryGray.600" justifyContent="center" flexDirection="row" mt="38px" ml="auto" mr="auto"
                    href="/img/onrevolt/Reflow_Resource.pdf" target="_blank"
                    type="application/octet-stream" download="Resource_Reflow_karta_katalogowa.pdf">
                    <Image
                      src="/img/onrevolt/Download_icon.svg"
                      alt="Pobierz"
                      w="35px"
                      h="35px"
                      style={{ display: 'inline', verticalAlign: 'middle' }}
                    />
                    Pobierz kartę katalogową
                  </Link>
                }
              />
            </Stack>
            <Text textAlign="center" w="100%" color="white" zIndex="10" fontSize="38px" fontWeight="700" lineHeight="52px" mt="18px" mb="28px">Technologia, która pracuje dla Twojej niezależności!</Text>
            <Card flexDirection="column" w="100%">
              <Box w="100%" position="relative" pb="55%" /* 16:9 aspect ratio */>
                <Image
                  src="/img/onrevolt/schemat.svg"
                  alt="schemat"
                  position="absolute"
                  top="0"
                  left="0"
                  w="100%"
                  h="100%"
                  objectFit="contain"
                  style={{ shapeRendering: 'auto' }}
                />
              </Box>
            </Card>
            <Card id="form" width="100%" height="750px" padding={0} overflow="hidden" mt="100px">
              <Widget id="qmBmINJn" style={{ width: "100%", height: "100%" }} />
            </Card>
          </Flex>
        </Flex>
      </PricingLayout>
      
    </Layout>
  );
}

export default Pricing;
