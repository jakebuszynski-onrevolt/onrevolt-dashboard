'use client';

import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Collapse,
  Flex,
  FormControl,
  FormHelperText,
  FormLabel,
  Image,
  Input,
  Select,
  Spinner,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import { useMemo, useState } from 'react';
import { MdExpandLess, MdExpandMore, MdLocationOn, MdOpenInNew, MdSearch } from 'react-icons/md';
import {
  LOCATION_MAP_IMAGE_VERSION,
  buildLocationMapViewerUrl,
  locationMapImageSource,
  locationMapProviders,
  normalizeLocationMapProvider,
} from 'lib/onrevolt/location-maps';

type AddressResult = {
  placeId: string;
  address: string;
  latitude: number;
  longitude: number;
  precision: string;
};

type InvestmentLocationPickerProps = {
  address: string;
  latitude: string;
  longitude: string;
  mapProvider: string;
  onAddressChange: (value: string) => void;
  onMapProviderChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
};

const precisionLabels: Record<string, string> = {
  ROOFTOP: 'Dokładny punkt budynku',
  RANGE_INTERPOLATED: 'Przybliżony numer budynku',
  GEOMETRIC_CENTER: 'Środek obiektu',
  APPROXIMATE: 'Lokalizacja przybliżona',
};

export default function InvestmentLocationPicker({
  address,
  latitude,
  longitude,
  mapProvider,
  onAddressChange,
  onMapProviderChange,
  onSelect,
}: InvestmentLocationPickerProps) {
  const [results, setResults] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.200');
  const resultHover = useColorModeValue('gray.50', 'whiteAlpha.100');
  const mutedColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const sectionHeaderBg = useColorModeValue('gray.50', 'whiteAlpha.50');
  const sectionHeaderHover = useColorModeValue('gray.100', 'whiteAlpha.100');
  const sectionHeaderOpenBorder = useColorModeValue('purple.400', 'purple.300');
  const sectionIconBg = useColorModeValue('purple.50', 'whiteAlpha.100');
  const sectionIconColor = useColorModeValue('purple.600', 'purple.200');
  const sectionArrowBg = useColorModeValue('white', 'whiteAlpha.100');
  const hasCoordinates = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    && latitude !== '' && longitude !== '';
  const normalizedProvider = normalizeLocationMapProvider(mapProvider);
  const viewerUrl = useMemo(() => (
    hasCoordinates
      ? buildLocationMapViewerUrl(normalizedProvider, Number(latitude), Number(longitude))
      : ''
  ), [hasCoordinates, latitude, longitude, normalizedProvider]);

  async function search() {
    setLoading(true);
    setError('');
    setResults([]);
    try {
      const response = await fetch(`/api/geolocation/search?q=${encodeURIComponent(address)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setResults(payload.data || []);
      if (!payload.data?.length) setError('Nie znaleziono adresu. Dopisz miejscowość i numer budynku.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormControl gridColumn={{ md: '1 / -1' }}>
      <Button
        variant="unstyled"
        display="flex"
        w="100%"
        h="auto"
        minH="64px"
        px={{ base: '12px', md: '16px' }}
        py="10px"
        border="1px solid"
        borderColor={isOpen ? sectionHeaderOpenBorder : borderColor}
        borderRadius="6px"
        bg={sectionHeaderBg}
        whiteSpace="normal"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        transition="background-color 0.15s ease, border-color 0.15s ease"
        _hover={{ bg: sectionHeaderHover }}
        _active={{ bg: sectionHeaderHover }}
        _focusVisible={{ boxShadow: 'outline' }}
      >
        <Flex align="center" gap="12px" w="100%">
          <Flex
            align="center"
            justify="center"
            w="38px"
            h="38px"
            flexShrink={0}
            borderRadius="6px"
            bg={sectionIconBg}
            color={sectionIconColor}
            aria-hidden="true"
          >
            <MdLocationOn size={22} />
          </Flex>
          <Box flex="1" minW="0" textAlign="left">
            <Text fontSize="md" fontWeight="700" lineHeight="short">
              Adres inwestycji i zdjęcie lokalizacji
            </Text>
            <Text mt="3px" fontSize="sm" fontWeight="400" color={mutedColor} lineHeight="short">
              Lokalizacja, źródło mapy i podgląd do oferty
            </Text>
          </Box>
          <Flex
            align="center"
            justify="center"
            w="34px"
            h="34px"
            flexShrink={0}
            borderRadius="6px"
            border="1px solid"
            borderColor={isOpen ? sectionHeaderOpenBorder : borderColor}
            bg={sectionArrowBg}
            color={isOpen ? sectionIconColor : mutedColor}
            aria-hidden="true"
          >
            {isOpen ? <MdExpandLess size={24} /> : <MdExpandMore size={24} />}
          </Flex>
        </Flex>
      </Button>
      <Collapse in={isOpen} animateOpacity>
        <Box pt="8px">
          <Flex gap="10px" direction={{ base: 'column', md: 'row' }}>
            <Input
              value={address}
              onChange={(event) => {
                onAddressChange(event.target.value);
                setResults([]);
                setImageError(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void search();
                }
              }}
              placeholder="Ulica, numer, miejscowość"
            />
            <Button leftIcon={loading ? <Spinner size="xs" /> : <MdSearch />} onClick={() => void search()} isDisabled={loading} flexShrink={0}>
              Znajdź na mapie
            </Button>
          </Flex>
          <FormHelperText>Adres wyszukuje Google. Wybrane niżej źródło obrazu zostanie użyte w ofercie i PDF.</FormHelperText>

          {error ? <Alert status="warning" mt="10px" borderRadius="6px"><AlertIcon />{error}</Alert> : null}

          {results.length ? (
            <Box border="1px solid" borderColor={borderColor} borderRadius="6px" mt="10px" overflow="hidden">
              {results.map((result) => (
                <Button
                  key={result.placeId}
                  variant="ghost"
                  borderRadius="0"
                  w="100%"
                  h="auto"
                  minH="54px"
                  px="14px"
                  py="9px"
                  justifyContent="flex-start"
                  textAlign="left"
                  whiteSpace="normal"
                  leftIcon={<MdLocationOn />}
                  _hover={{ bg: resultHover }}
                  onClick={() => {
                    onSelect(result);
                    setResults([]);
                    setImageError(false);
                  }}
                >
                  <Box>
                    <Text fontWeight="700">{result.address}</Text>
                    <Text color={mutedColor} fontSize="xs">{precisionLabels[result.precision] || 'Lokalizacja Google Maps'}</Text>
                  </Box>
                </Button>
              ))}
            </Box>
          ) : null}

          {hasCoordinates ? (
            <Box mt="12px" maxW="702px">
              <Flex gap="10px" direction={{ base: 'column', sm: 'row' }} mb="10px">
                <FormControl>
                  <FormLabel fontSize="sm" mb="5px">Źródło obrazu</FormLabel>
                  <Select
                    value={normalizedProvider}
                    onChange={(event) => {
                      onMapProviderChange(event.target.value);
                      setImageError(false);
                    }}
                  >
                    {locationMapProviders.map((provider) => (
                      <option key={provider.value} value={provider.value}>{provider.label}</option>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  as="a"
                  href={viewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  leftIcon={<MdOpenInNew />}
                  variant="outline"
                  alignSelf={{ sm: 'flex-end' }}
                  flexShrink={0}
                >
                  Otwórz mapę
                </Button>
              </Flex>
              {!imageError ? (
                <Box w="702px" maxW="100%">
                  <Image
                    key={`${LOCATION_MAP_IMAGE_VERSION}-${normalizedProvider}-${latitude}-${longitude}`}
                    src={`/api/geolocation/satellite?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}&provider=${encodeURIComponent(normalizedProvider)}&v=${LOCATION_MAP_IMAGE_VERSION}`}
                    alt={`Zdjęcie lokalizacji ${address} ze źródła ${normalizedProvider}`}
                    w="100%"
                    aspectRatio="351 / 249"
                    objectFit="cover"
                    borderRadius="6px"
                    border="1px solid"
                    borderColor={borderColor}
                    onError={() => setImageError(true)}
                  />
                </Box>
              ) : (
                <Alert status="warning" borderRadius="6px"><AlertIcon />Nie udało się pobrać obrazu z wybranego źródła.</Alert>
              )}
              <Text mt="5px" color={mutedColor} fontSize="xs">
                Obraz do oferty: {locationMapImageSource(normalizedProvider)}.
              </Text>
            </Box>
          ) : null}
        </Box>
      </Collapse>
    </FormControl>
  );
}
