'use client';

import { SearchIcon } from '@chakra-ui/icons';
import { Box, Flex, IconButton, Input, InputGroup, InputLeftElement, Spinner, Text, useColorModeValue } from '@chakra-ui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type SearchResult = { type: string; id: string; title: string; subtitle?: string; href: string };

const typeLabels: Record<string, string> = {
  client: 'Klient',
  project: 'Projekt',
  offer: 'Oferta',
  product: 'Produkt',
};

export function SearchBar(props: {
  variant?: string;
  background?: string;
  children?: JSX.Element;
  placeholder?: string;
  borderRadius?: string | number;
  [x: string]: any;
}) {
  const { background, placeholder, borderRadius, children: _children, variant: _variant, ...rest } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchIconColor = useColorModeValue('gray.700', 'white');
  const inputBg = useColorModeValue('secondaryGray.300', 'navy.900');
  const inputText = useColorModeValue('gray.700', 'gray.100');
  const menuBg = useColorModeValue('white', 'navy.800');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const payload = await response.json();
        setResults(response.ok && payload.ok ? payload.data : []);
        setOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [query]);

  function selectResult(result: SearchResult) {
    setOpen(false);
    setQuery('');
    router.push(result.href);
  }

  return (
    <Box position="relative" ref={rootRef} w={{ base: '100%', md: '280px' }} {...rest}>
      <InputGroup>
        <InputLeftElement><IconButton aria-label="Wyszukaj" bg="inherit" borderRadius="inherit" _active={{ bg: 'inherit', transform: 'none', borderColor: 'transparent' }} _focus={{ boxShadow: 'none' }} icon={<SearchIcon color={searchIconColor} w="15px" h="15px" />} /></InputLeftElement>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setOpen(Boolean(results.length || query.length >= 2))} variant="search" fontSize="sm" bg={background || inputBg} color={inputText} fontWeight="500" _placeholder={{ color: 'gray.400', fontSize: '14px' }} borderRadius={borderRadius || '30px'} placeholder={placeholder || 'Szukaj w CRM...'} />
        {loading ? <Spinner position="absolute" right="12px" top="12px" size="sm" zIndex="2" /> : null}
      </InputGroup>
      {open ? (
        <Box position="absolute" top="calc(100% + 8px)" right="0" w={{ base: '100%', md: '380px' }} bg={menuBg} border="1px solid" borderColor={borderColor} borderRadius="8px" boxShadow="xl" maxH="420px" overflowY="auto" zIndex="popover">
          {results.map((result) => (
            <Flex key={`${result.type}-${result.id}`} as="button" type="button" w="100%" textAlign="left" p="12px" gap="10px" borderBottom="1px solid" borderColor={borderColor} _hover={{ bg: inputBg }} onClick={() => selectResult(result)}>
              <Text color={mutedColor} fontSize="xs" minW="52px">{typeLabels[result.type] || result.type}</Text>
              <Box minW="0"><Text color={inputText} fontWeight="700" fontSize="sm" noOfLines={1}>{result.title}</Text><Text color={mutedColor} fontSize="xs" noOfLines={1}>{result.subtitle}</Text></Box>
            </Flex>
          ))}
          {!loading && !results.length ? <Text color={mutedColor} p="14px" fontSize="sm">Brak wyników</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}
