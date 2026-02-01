'use client';

// Chakra imports
import {
  Button,
  Flex,
  FormLabel,
  Icon,
  Select,
  SimpleGrid,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  useColorModeValue,
} from '@chakra-ui/react';

// na górze pliku
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';


// Custom components
import Card from 'components/card/Card';
import InputField from 'components/fields/InputField';
import TextField from 'components/fields/TextField';
import TagsField from 'components/fields/TagsField';
//import Dropzone from 'components/admin/main/ecommerce/new-product/Dropzone';
import React, { useState } from 'react';
// Assets
import { MdOutlineCloudUpload } from 'react-icons/md';

import { useEffect, useMemo, type FC } from "react";
import { Box, Center, Code, Spinner, Text } from "@chakra-ui/react";
import { apiPath } from "@/lib/basePath";

const UserGeoSection = dynamic(
  () => import("@/components/users/UserGeoSection"),
  { ssr: false }
) as unknown as FC;

type CreateFormProps = {
  isAdmin?: boolean;
};

const CreateForm = dynamic(
  () => import("@/components/users/CreateForm"),
  { ssr: false }
) as any;


/* ===================== helpers ===================== */
const ALIAS_MAXLEN = 57;

const snake = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const ensureRaport = (ref: string) => {
  const s = snake(ref);
  return s.startsWith("raport_") ? s : `raport_${s}`;
};

function firstLast(name?: string) {
  const s = (name || "").trim();
  if (!s) return { first_name: "", last_name: "" };
  const [f, ...r] = s.split(/\s+/);
  return { first_name: f || "", last_name: r.join(" ") || "" };
}

type PdDebug = {
  id?: number | string;
  title?: string;
  person?: any;
  custom_by_name?: Record<string, any>;
};


export default function Page() {
  const textColor = useColorModeValue('secondaryGray.900', 'white');

  const router = useRouter();
  const searchParams = useSearchParams();
  const currentProjectId = searchParams.get('projectId') ?? '1';

  const [activeBullets, setActiveBullets] = useState({
    product: currentProjectId === '1',
    media: currentProjectId === '2',
    pricing: currentProjectId === '3',
  });

  const handleProjectTabClick = (projectId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('projectId', projectId);
    router.push(`?${params.toString()}`);
  };

  const typKlientaTab = React.useRef() as React.MutableRefObject<HTMLInputElement>;
  const raportTab = React.useRef() as React.MutableRefObject<HTMLInputElement>;
  const konfigTab = React.useRef() as React.MutableRefObject<HTMLInputElement>;
  const ofertaTab = React.useRef() as React.MutableRefObject<HTMLInputElement>;
  const brand = useColorModeValue('brand.500', 'brand.400');

  const sp = useSearchParams();

  const [setSchema] = useState<any>(null);
  const [initialValues, setInitialValues] = useState<Record<string, any>>({});
  const [pdDebug, setPdDebug] = useState<PdDebug | null>(null);
  const [loading, setLoading] = useState(true);

  const showDebugUI =
    sp.get("debug") === "1" || sp.get("debug") === "true";

  // tylko identyfikatory (deal_id/person_id) – NIE wysyłamy całych danych w URL
  const hidden = useMemo(() => {
    const obj: Record<string, string> = {};
    sp.forEach((v, k) => (obj[k] = v));
    return obj;
  }, [sp]);

  // ====== HOOKI ZAWSZE WYWOŁYWANE ======
  const personSummary = useMemo(() => {
    const p = pdDebug?.person;
    if (!p) return null;
    const email =
      Array.isArray(p.email) && p.email.length
        ? p.email[0]?.value || p.email[0]
        : "";
    const phone =
      Array.isArray(p.phone) && p.phone.length
        ? p.phone[0]?.value || p.phone[0]
        : "";
    return { name: p.name, email, phone, id: p.id };
  }, [pdDebug]);

  // helper do ładnego wypisu wartości – użyjesz np. w debug panelu
  const renderVal = (v: any) => {
    if (v == null)
      return (
        <Text as="span" color="gray.500">
          —
        </Text>
      );
    if (Array.isArray(v)) return <Code>{JSON.stringify(v)}</Code>;
    if (typeof v === "object")
      return (
        <Code whiteSpace="pre-wrap">
          {JSON.stringify(v)}
        </Code>
      );
    const s = String(v);
    return (
      <Text as="span">
        {s.length > 200 ? s.slice(0, 200) + "…" : s}
      </Text>
    );
  };

const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) {
          // 401/404 -> traktujemy jako zwykłego użytkownika
          setIsAdmin(false);
          return;
        }
        const data = await res.json();
        // role == 1 -> admin
        setIsAdmin(Number(data.role) === 1);
      } catch (e) {
        console.error('auth/me error:', e);
        setIsAdmin(false);
      }
    })();
  }, []);

useEffect(() => {
  setActiveBullets({
    product: currentProjectId === '1',
    media: currentProjectId === '2',
    pricing: currentProjectId === '3',
  });
}, [currentProjectId]);


  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) schema z Typeform – nadal potrzebna tylko po to,
        //    żeby poprawnie zmapować refy -> custom_by_name
        const formId =
          sp.get("form_id") ||
          process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID ||
          "";

        // 2) prefill z Pipedrive po deal_id
        const dealId = sp.get("deal_id");
        let prefill: Record<string, any> = {};
        let pdDbg: PdDebug | null = null;

        if (dealId) {
          const rDeal = await fetch(
            apiPath(`/api/pipedrive/deals/${dealId}`),
            {
              cache: "no-store",
            }
          );
          if (rDeal.ok) {
            const j = await rDeal.json();
            pdDbg = {
              id: j?.id,
              title: j?.title,
              person: j?.person,
              custom_by_name: j?.custom_by_name || {},
            };

            const c = j?.custom_by_name || {};
            const iv: Record<string, any> = {};

            // a) zasiej WSZYSTKO z custom_by_name
            for (const [k, v] of Object.entries(c)) iv[k] = v;

            // b) mapowanie pól raport_* z użyciem reguły 57 znaków 
            //dupa 57 znaków 

            // c) gdyby schema była pusta, dopisz kilka znanych długich refów
            const KNOWN_REFS = [
              // ELEKTR
              "raport_jaki_by_koszt_za_energie_elektryczna_w_ostatnich_2_miesiacach",
              "raport_czy_posiadasz_ostatni_rachunek_za_prad_w_postaci_pliku_pdf",
              "raport_podaj_kwote_ostatniego_rachunku_za_prad_za_dwa_miesiace",

              // CIEPŁO
              "raport_jaki_by_koszt_za_energie_cieplna_w_ostatnich_2_miesiacach",
              "raport_czy_posiadasz_ostatni_rachunek_za_energie_cieplna_w_postaci_pliku_pdf",
            ];

            // d) osoba → first_name / last_name / email / phone_number
            const p = j?.person;
            if (p) {
              const { first_name, last_name } = firstLast(p.name);
              if (first_name) iv.first_name = first_name;
              if (last_name) iv.last_name = last_name;

              const email =
                Array.isArray(p.email) && p.email.length
                  ? p.email[0]?.value || p.email[0]
                  : "";
              const phone =
                Array.isArray(p.phone) && p.phone.length
                  ? p.phone[0]?.value || p.phone[0]
                  : "";
              if (email) iv.email = email;
              if (phone) iv.phone_number = phone;
            }

            prefill = iv;
          }
        }

        setInitialValues(prefill);
        setPdDebug(pdDbg);
      } finally {
        setLoading(false);
      }
    })();
  }, [sp]);


  return (
    <Flex
      direction="column"
      minH="100vh"
      align="center"
      pt={{ sm: '125px', lg: '85px' }}
      position="relative"
    >
      <Box
        h="45vh"
        bgGradient="linear(to-br, brand.400, brand.600)"
        position="absolute"
        w="100%"
        borderRadius="30px"
      />

      <Tabs
        variant="unstyled"
        mt={{ base: '60px', md: '80px' }}
        zIndex="0"
        display="flex"
        flexDirection="column"
        w="95%"
      >
        <TabList
          display="flex"
          alignItems="center"
          alignSelf="center"
          justifySelf="center"
        >

          <Tab
            _focus={{ border: '0px', boxShadow: 'unset' }}
            ref={raportTab}
            w={{ sm: '100px', md: '150px', lg: '200px' }}
            onClick={() => {
              setActiveBullets({
                product: true,
                media: false,
                pricing: false,
              });
              handleProjectTabClick('1'); // ID projektu dla pierwszej pozycji
            }}
          >
            <Flex
              direction="column"
              justify="center"
              align="center"
              position="relative"
              _before={{
                content: "''",
                width: { sm: '100px', md: '150px', lg: '200px' },
                height: '3px',
                bg: activeBullets.media ? 'white' : '#8476FF',
                left: { sm: '12px', md: '40px' },
                top: {
                  sm: activeBullets.product ? '6px' : '4px',
                  md: null,
                },
                position: 'absolute',
                bottom: activeBullets.product ? '40px' : '38px',

                transition: 'all .3s ease',
              }}
            >
              <Box
                zIndex="1"
                border="2px solid"
                borderColor={activeBullets.product ? 'white' : 'brand.400'}
                bgGradient="linear(to-b, brand.400, brand.600)"
                w="16px"
                h="16px"
                mb="8px"
                borderRadius="50%"
              />
              <Text
                color={activeBullets.product ? 'white' : 'gray.300'}
                fontWeight={activeBullets.product ? 'bold' : 'normal'}
                display={{ sm: 'none', md: 'block' }}
              >
                Re:port
              </Text>
            </Flex>
          </Tab>
          <Tab
            _focus={{ border: '0px', boxShadow: 'unset' }}
            ref={konfigTab}
            w={{ sm: '100px', md: '150px', lg: '200px' }}
            onClick={() => {
              setActiveBullets({
                product: true,
                media: true,
                pricing: false,
              });
              handleProjectTabClick('2'); // drugi projekt
            }}
          >
            <Flex
              direction="column"
              justify="center"
              align="center"
              position="relative"
              _before={{
                content: "''",
                width: { sm: '100px', md: '150px', lg: '200px' },
                height: '3px',
                bg: activeBullets.pricing ? 'white' : '#8476FF',
                left: { sm: '12px', md: '28px' },
                top: '6px',
                position: 'absolute',
                bottom: activeBullets.media ? '40px' : '38px',

                transition: 'all .3s ease',
              }}
            >
              <Box
                zIndex="1"
                border="2px solid"
                borderColor={activeBullets.media ? 'white' : 'brand.400'}
                bgGradient="linear(to-b, brand.400, brand.600)"
                w="16px"
                h="16px"
                mb="8px"
                borderRadius="50%"
              />
              <Text
                color={activeBullets.media ? 'white' : 'gray.300'}
                fontWeight={activeBullets.media ? 'bold' : 'normal'}
                display={{ sm: 'none', md: 'block' }}
              >
                Konfigurator
              </Text>
            </Flex>
          </Tab>
          <Tab
            _focus={{ border: '0px', boxShadow: 'unset' }}
            ref={ofertaTab}
            w={{ sm: '100px', md: '150px', lg: '200px' }}
            onClick={() => {
              setActiveBullets({
                product: true,
                media: true,
                pricing: true,
              });
              handleProjectTabClick('3'); // trzeci projekt
            }}
          >
            <Flex
              direction="column"
              justify="center"
              align="center"
              position="relative"
            >
              <Box
                zIndex="1"
                border="2px solid"
                borderColor={activeBullets.pricing ? 'white' : 'brand.400'}
                bgGradient="linear(to-b, brand.400, brand.600)"
                w="16px"
                h="16px"
                mb="8px"
                borderRadius="50%"
              />
              <Text
                color={activeBullets.pricing ? 'white' : 'gray.300'}
                fontWeight={activeBullets.pricing ? 'bold' : 'normal'}
                display={{ sm: 'none', md: 'block' }}
              >
                Oferta
              </Text>
            </Flex>
          </Tab>
        </TabList>
        <Box mt="0px" w="100%" maxW={{ md: '90%', w: '95%' }}>
          <CreateForm key={currentProjectId} isAdmin={isAdmin} />
        </Box>
      </Tabs>
    </Flex>
  );
}


