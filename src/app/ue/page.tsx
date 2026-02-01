'use client';

import { Box, AspectRatio } from '@chakra-ui/react';
import Card from 'components/card/Card';
import { Image } from 'components/image/Image';
import PricingLayout from 'components/auth/variants/PricingAuthLayout/page';
import Layout from 'app/auth/layout';

function Pricing() {
  return (
    <Layout>
      {/* Strażnik na ewentualny poziomy overflow */}
      <Box overflowX="hidden" position="relative">
        {/* TŁO */}
        <Box
          position="absolute"
          inset={0}
          zIndex={0}
          w="100vw"
          overflow="hidden"
        >
          <AspectRatio w="100vw" maxW="100vw" ratio={1920 / 1158}>
            <Image
              src="/img/onrevolt/ue_turbiny.jpg"
              w="100vw"
              h="auto"
              alt="UE tło"
            />
          </AspectRatio>
        </Box>

        {/* KONTENT */}
        <PricingLayout
          contentTop={{ base: '140px', md: '5vh' }}
          contentBottom={{ base: '50px', lg: 'auto' }}
        >
          <Box w="100%" px={{ base: 4, md: 6 }}>
            <Card
              display="flex"
              flexDirection="column"
              zIndex={10}
              w="100%"
              maxW="1100px"
              mx="auto"
              mt={{ base: '24vh', md: '30vh' }}
            >
              <p> onRevolt Sp. z o. o. (wcześniej NTW Wind Systems Sp. z o.o.) realizuje projekt dofinansowany z Funduszy Europejskich NTW – “Innowacyjna nadomowa turbina wiatrowa wysokoefektywna w warunkach słabego wiatru”. Projekt finansowany ze środków w ramach Działania 1.3 Prace B+R finansowane z udziałem funduszy kapitałowych, Poddziałania 1.3.1 „Wsparcie Projektów badawczo-rozwojowych w fazie preseed przez fundusze typu proof of concept – BRIdge Alfa”, Program Operacyjny Inteligentny Rozwój 2014-2020.</p>
              <br />
              <p>Celem projektu była realizacja prac badawczo-rozwojowych  dotyczącym systemu do generacji energii elektrycznej z energii wiatru w warunkach przydomowych, a efektami projektu było utworzenie prototypu urządzenia nadomowej elektrowni wiatrowej o dużym uzysku energii przy warunkach słabego wiatru (średnia roczna 3,5 m/s) i przetestowanie go w warunkach zbliżonych do rzeczywistych.</p>
              <br />

              <Box
                as="table"
                sx={{
                  width: { base: '100%', md: '520px' },
                  borderCollapse: 'collapse',
                  mt: '16px',
                  mb: '16px',
                }}
              >
                <tbody>
                  <tr>
                    <Box as="td" sx={{ border: '0', p: '8px', fontWeight: 'bold' }}>
                      Dofinansowanie projektu z UE:
                    </Box>
                    <Box as="td" sx={{ border: '0', p: '8px' }}>
                      880 000 PLN
                    </Box>
                  </tr>
                  <tr>
                    <Box as="td" sx={{ border: '0', p: '8px', fontWeight: 'bold' }}>
                      Całkowita kwota projektu:
                    </Box>
                    <Box as="td" sx={{ border: '0', p: '8px' }}>
                      1 100 000 PLN
                    </Box>
                  </tr>
                </tbody>
              </Box>

              <br />
              <p>Dalsze prace B+R powyżej TRL5 są realizowane ze środków prywatnych.</p>

              <AspectRatio w="100%" maxW="1100px" ratio={1168 / 130} mt="24px">
                <Image
                  src="/img/onrevolt/logotypy_ue.png"
                  w="100%"
                  h="auto"
                  alt="Logotypy UE"
                />
              </AspectRatio>
            </Card>
          </Box>
        </PricingLayout>
      </Box>
    </Layout>
  );
}

export default Pricing;
