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

// Assets
import deloitteLogo from '/public/svg/deloitte-logo.svg';
import georgiaLogo from '/public/svg/georgia-logo.svg';
import googleLogo from '/public/svg/google-logo.svg';
import microsoftLogo from '/public/svg/microsoft-logo.svg';
import msnLogo from '/public/svg/msn-logo.svg';
import zohoLogo from '/public/svg/zoho-logo.svg';
import { ReflowLogo, ResourceLogo, RevolveLogo } from 'components/icons/Icons';
// Custom components
import PricingLayout from '../../components/auth/variants/PricingAuthLayout/page';
import { useState, useEffect, useRef } from 'react';
import Pack from 'components/admin/main/others/pricing/Pack';
import Layout from 'app/auth/layout';
import { Widget } from '@typeform/embed-react';

function Pricing() {
  useEffect(() => {

  }, []);

  const textColor = useColorModeValue('secondaryGray.900', 'white');
  return (
    <Layout>
      <Box
        position="absolute"
        top={0}
        right={0}
        bottom={0}
        zIndex={0}
        left={0}
        w="100%"
        h="auto"
      >
        <AspectRatio position="relative" w="100%" maxW="100%" ratio={1920 / 1134}>
          <Image
            src="/img/onrevolt/ue_turbiny.png"
            width="100vw"
            height="auto"
          />
        </AspectRatio>
      </Box>

      <PricingLayout
        contentTop={{ base: '140px', md: '5vh' }}
        contentBottom={{ base: '50px', lg: 'auto' }}
        width="100%"
      >

        <Card
          direction="column"
          zIndex={10}
          width="100%"
          mt="30vh"
        >
          <p> onRevolt Sp. z o. o. (wcześniej NTW Wind Systems Sp. z o.o.) realizuje projekt dofinansowany z Funduszy Europejskich NTW – “Innowacyjna nadomowa turbina wiatrowa wysokoefektywna w warunkach słabego wiatru”. Projekt finansowany ze środków w ramach Działania 1.3 Prace B+R finansowane z udziałem funduszy kapitałowych, Poddziałania 1.3.1 „Wsparcie Projektów badawczo-rozwojowych w fazie preseed przez fundusze typu proof of concept – BRIdge Alfa”, Program Operacyjny Inteligentny Rozwój 2014-2020.</p>
          <br />
          <p>Celem projektu była realizacja prac badawczo-rozwojowych  dotyczącym systemu do generacji energii elektrycznej z energii wiatru w warunkach przydomowych, a efektami projektu było utworzenie prototypu urządzenia nadomowej elektrowni wiatrowej o dużym uzysku energii przy warunkach słabego wiatru (średnia roczna 3,5 m/s) i przetestowanie go w warunkach zbliżonych do rzeczywistych.</p>
          <br />
          <table style={{ width: "30%", borderCollapse: "collapse", marginTop: "16px", marginBottom: "16px" }}>
            <tbody>
              <tr>
                <td style={{ border: "0px solid #e2e8f0", padding: "8px", fontWeight: "bold" }}>Dofinansowanie projektu z UE:</td>
                <td style={{ border: "0px solid #e2e8f0", padding: "8px" }}>880 000 PLN</td>
              </tr>
              <tr>
                <td style={{ border: "0px solid #e2e8f0", padding: "8px", fontWeight: "bold" }}>Całkowita kwota projektu:</td>
                <td style={{ border: "0px solid #e2e8f0", padding: "8px" }}>1 100 000 PLN</td>
              </tr>
            </tbody>
          </table>
          <br />
          <p>Dalsze prace B+R powyżej TRL5 są realizowane ze środków prywatnych.</p>
          <AspectRatio w="100%" maxW="100%" ratio={1168 / 130}>
            <Image
              src="/img/onrevolt/logotypy_ue.png"
              width="100%"
              height="auto"
            />
          </AspectRatio>
        </Card>
      </PricingLayout>
    </Layout>
  );
}

export default Pricing;
