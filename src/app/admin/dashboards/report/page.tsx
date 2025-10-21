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

// Chakra imports
import { Box, Button, Grid, SimpleGrid, AspectRatio, Stack, Link, Image, Text } from '@chakra-ui/react';
import Pack from 'components/admin/main/others/pricing/Pack';
import Information from 'components/admin/main/profile/overview/Information';
import { RevolveLogo, ReflowLogo, ResourceLogo } from 'components/icons/Icons';
// Assets
import home from '/public/img/dashboards/home.png';
// Custom components
import Card from 'components/card/Card';
import General from 'components/admin/dashboards/smart-home/General';
import Light from 'components/admin/dashboards/smart-home/Light';
import MapCard from 'components/admin/dashboards/smart-home/MapCard';
import Plan from 'components/admin/dashboards/smart-home/Plan';
import Temperature from 'components/admin/dashboards/smart-home/Temperature';
import Weather from 'components/admin/dashboards/smart-home/Weather';
import Consumption from 'components/admin/dashboards/smart-home/Consumption';
import AddDevice from 'components/admin/dashboards/smart-home/AddDevice';
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { toPng } from 'html-to-image';

export default function SmartHome() {
    const [currentPage, setCurrentPage] = useState<number | null>(0);
    const [imageSrc1, setImageSrc1] = useState<string | null>(null);
    const [imageSrc2, setImageSrc2] = useState<string | null>(null);
    const [imageSrc3, setImageSrc3] = useState<string | null>(null);
    const componentRef1 = useRef<HTMLDivElement>(null);
    const componentRef2 = useRef<HTMLDivElement>(null);
    const componentRef3 = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (currentPage === 0) {
            toPng(componentRef1.current).then((dataUrl) => {
                setImageSrc1(dataUrl);
            });
        }
        if (currentPage === 1) {
            toPng(componentRef2.current).then((dataUrl) => {
                setImageSrc2(dataUrl);
            });
        }
        if (currentPage === 2) {
            toPng(componentRef3.current).then((dataUrl) => {
                setImageSrc3(dataUrl);
            });
        }
    }, [currentPage]);
  // Chakra Color Mode
  return (
        <Grid pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px"
            mb="20px" templateColumns="0.25fr 0.75fr">
              <SimpleGrid
                columns={{ base: 1, md: 1, '2xl': 1 }}
                  gap="20px"
                  mb="20px"
              >
                <AspectRatio backgroundColor="#EEF1F9" w="100%" maxW="100%" ratio={210 / 297} onClick={() => setCurrentPage(0)} cursor="pointer">
                    <Box
                      bgSize="cover"
                      w=""
                      minH={{ base: '310px', md: '100%' }}
                        bgImage={imageSrc1}
                        imageRendering="auto"

                    >

                    </Box>
                </AspectRatio>
                <AspectRatio backgroundColor="#EEF1F9" w="100%" maxW="100%" ratio={210 / 297} onClick={() => setCurrentPage(1)} cursor="pointer">
                    <Box
                        bgSize="cover"
                        w=""
                        minH={{ base: '310px', md: '100%' }}
                        bgImage={imageSrc2}
                    >

                    </Box>
                </AspectRatio>
                <AspectRatio backgroundColor="#EEF1F9" w="100%" maxW="100%" ratio={210 / 297} onClick={() => setCurrentPage(2)} cursor="pointer">
                    <Box
                        bgSize="cover"
                        w=""
                        minH={{ base: '310px', md: '100%' }}
                        bgImage={imageSrc3}
                    >

                    </Box>
                </AspectRatio>


                {/* <Temperature/>
                  <Weather /> */}
                {/* <Light />
                  <Consumption />
                  <MapCard/> */}
            </SimpleGrid>
            <AspectRatio display={currentPage === 0 ? 'block' : 'none'} backgroundColor="#EEF1F9" w="100%" maxW="100%" ratio={210 / 297}
                ref={componentRef1}>
                <Box display="flex" w="100%" h="100%" flexDirection="column" p="4%" gap="20px" alignItems="baseline !important">
                    {/* A4 Paper Area */}
                    <Image src="/img/onrevolt/Report_logo_black.svg" alt="Report" width="15%" shapeRendering="auto" />
                    <Card flexDirection="column" w="100%" height="17%" borderRadius="25px" alignItems="flex-start" gap="10px" p="15px">
                        <Text fontSize="1.5rem" color="secondaryGray.900" fontWeight="semibold" ml="10px">Dane osobowe</Text>
                        <Stack
                            direction="row"
                            alignItems="top"
                            spacing="20px"
                            verticalAlign="top"
                            mt="0"
                            w="100%"
                            height="35%"
                        >
                            <Information borderRadius="15px" title="Imię i nazwisko" value="_________________" />
                            <Information borderRadius="15px" title="Liczba domowników" value="__" />
                            <Information borderRadius="15px" title="Budynek - typ i metraż" value="_________________m2" />
                        </Stack>
                        <Stack
                            direction="row"
                            alignItems="top"
                            spacing="20px"
                            verticalAlign="top"
                            mt="0"
                            w="100%"
                            height="35%"
                        >
                             <Information borderRadius="15px" title="Lokalizacja" value="____________________" />
                             <Information borderRadius="15px" title="źródło ciepła" value="______, Moc ____ kW" />
                             <Information borderRadius="15px" atitle="Operator" value="__________________" />
                        </Stack>

                    </Card>
                    <Stack
                        direction="row"
                        alignItems="top"
                        spacing="20px"
                        verticalAlign="top"
                        mt="0"
                        w="100%"
                        height="19%"
                    >
                        <Card flexDirection="column" w="33%" p="13px"  borderRadius="25px">
                        <Information bgColor="#FF3B30" titleColor="white" textColor="white" borderRadius="18px" title="Twój rachunek roczny" value={<Text color="white" fontSize="1.7rem" fontWeight="bold"> 18000PLN <Text as="span" fontStyle="italic" fontSize="0.75rem" fontWeight="100">brutto</Text></Text>} />

                        </Card>
                        <Card flexDirection="column" w="66%"  borderRadius="25px">
                        <Text fontSize="1.5rem" color="secondaryGray.900" fontWeight="semibold" ml="10px">Wzrost cen prądu <Text as="span" fontStyle="italic" fontSize="0.75rem" fontWeight="100">(w gospodarstwie domowym zużywającym 2000kWh/rok w taryfie G11)</Text></Text>
                        
                        </Card>
                    </Stack>
                    <Card flexDirection="column" w="100%" height="17%" borderRadius="25px" alignItems="flex-start" gap="10px" p="15px">
                    <Text fontSize="1.5rem" color="secondaryGray.900" fontWeight="semibold" ml="10px">Dane środowiskowe</Text>
                        <Stack
                            direction="row"
                            alignItems="top"
                            spacing="20px"
                            verticalAlign="top"
                            mt="0"
                            w="100%"
                            height="35%"
                        >
                            <Information borderRadius="15px" title="Rodzaj terenu" value="_________________" />
                            <Information borderRadius="15px" title="Moduły fotowoltaiczne" value="_________________" />
                            <Information borderRadius="15px" title="Magazyn Energii" value="_________________" />
                        </Stack>
                        <Stack
                            direction="row"
                            alignItems="top"
                            spacing="20px"
                            verticalAlign="top"
                            mt="0"
                            w="100%"
                            height="35%"
                        >
                             <Information borderRadius="15px" title="Rodzaj dachu" value="____________________" />
                             <Information borderRadius="15px" title="Kolektory słoneczne" value="_________________" />
                             <Information borderRadius="15px" title="Magazyn ciepła" value="__________________" />
                        </Stack>
                    </Card>
                    <Stack
                        direction="row"
                        alignItems="top"
                        spacing="20px"
                        verticalAlign="top"
                        mt="0"
                        w="100%"
                        height="17%"
                    >
                        <MapCard w="33%" />
                        <MapCard w="33%" />
                        <Card flexDirection="column" w="33%"  borderRadius="25px">

                        </Card>
                    </Stack>
                    <Stack
                        direction="row"
                        alignItems="top"
                        spacing="20px"
                        verticalAlign="top"
                        mt="0"
                        w="100%" height="19%"
                    >
                        <Card flexDirection="column" w="66%"  borderRadius="25px">

                        </Card>
                        <Card flexDirection="column" w="33%"  borderRadius="25px">

                        </Card>
                    </Stack>
                </Box>
            </AspectRatio>
            <AspectRatio display={currentPage === 1 ? 'block' : 'none'} backgroundColor="#EEF1F9" w="100%" maxW="100%" ratio={210 / 297}
                ref={componentRef2}>
                <Box display="flex" w="100%" h="100%" flexDirection="column" p="4%" gap="20px" alignItems="baseline !important">
                    {/* A4 Paper Area */}
                    <Image src="/img/onrevolt/Report_logo_black.svg" alt="Report" width="15%" shapeRendering="auto" />
                    <Stack
                        direction="row"
                        alignItems="top"
                        spacing="20px"
                        verticalAlign="top"
                        mt="0"
                        w="100%"
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
                        />
                        <Pack
                            title={<ReflowLogo width={104} />}
                            desc="Centrum energetycznej niezależności"
                            statement={["zmniejsza Twoje rachunki nawet o ", <Text color='secondaryGray.900' fontWeight="bold" as="span" fontSize="2.5rem">80%</Text>]}
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

                        />
                        <Pack
                            title={<ResourceLogo width={137} />}
                            desc="Magazyn, który daje Ci niezależność"
                            statement={["gromadzi ", <Text color="secondaryGray.900" as="span" fontWeight="bold" fontSize="2.5rem">15kWh</Text>, " energii w zasięgu Twoich potrzeb"]}
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
                        />
                    </Stack>
                    <Card flexDirection="column" w="100%">
                        <Box w="100%" position="relative" pb="55%" /* 16:9 aspect ratio */>
                            <Image
                                src="/img/onrevolt/schemat.svg"
                                shapeRendering="auto"
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
                </Box>
            </AspectRatio>
            <AspectRatio display={currentPage === 2 ? 'block' : 'none'} backgroundColor="#EEF1F9" w="100%" maxW="100%" ratio={210 / 297}
                ref={componentRef3}>
                <Box display="flex" w="100%" h="100%" flexDirection="column" p="4%" gap="20px" alignItems="baseline !important">
                    {/* A4 Paper Area */}
                    <Image src="/img/onrevolt/Report_logo_black.svg" alt="Revolve" width="15%" shapeRendering="auto" />
                    <Stack
                        direction="row"
                        alignItems="top"
                        spacing="20px"
                        verticalAlign="top"
                        mt="0"
                        w="100%"
                        height="60%"
                    >
                        <Card flexDirection="column" w="33%">

                        </Card>
                        <Card flexDirection="column" w="33%">

                        </Card>
                        <Card flexDirection="column" w="33%">

                        </Card>
                    </Stack>
                    <Card flexDirection="column" w="100%" height="40%"></Card>
          </Box>
            </AspectRatio>


        </Grid >
  );
}
