'use client';

import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Icon,
  IconButton,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import {
  energyOperatorOptions,
  getDefaultEnergyTariff,
  getDefaultTargetEnergyTariff,
  getEnergyTariffs,
} from 'lib/onrevolt/energy-tariffs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MdAdd, MdKeyboardArrowDown, MdOpenInNew, MdPrint, MdRefresh } from 'react-icons/md';
import OfferDocument from './OfferDocument';

type OfferForm = {
  projectId: string;
  configurationId: string;
  title: string;
  validUntil: string;
  subsidyGross: string;
  thermoReliefGross: string;
  currentAnnualBillGross: string;
  projectedAnnualBillGross: string;
  energyOperator: string;
  tariffBefore: string;
  tariffAfter: string;
  settlementBefore: string;
  settlementAfter: string;
  descriptionBefore: string;
  descriptionAfter: string;
  notes: string;
};

const emptyForm: OfferForm = {
  projectId: '',
  configurationId: '',
  title: '',
  validUntil: '',
  subsidyGross: '0',
  thermoReliefGross: '0',
  currentAnnualBillGross: '0',
  projectedAnnualBillGross: '0',
  energyOperator: 'ENEA',
  tariffBefore: 'G11',
  tariffAfter: 'G13active',
  settlementBefore: 'net-metering',
  settlementAfter: 'net-billing',
  descriptionBefore: '',
  descriptionAfter: '',
  notes: '',
};

const offerStatuses = [
  ['DRAFT', 'Robocza'],
  ['SENT', 'Wysłana'],
  ['ACCEPTED', 'Zaakceptowana'],
  ['REJECTED', 'Odrzucona'],
  ['EXPIRED', 'Wygasła'],
] as const;

function statusLabel(value?: string | null) {
  return offerStatuses.find(([status]) => status === value)?.[1] || value || 'Robocza';
}

function statusColor(value?: string | null) {
  if (value === 'ACCEPTED') return 'green';
  if (value === 'SENT') return 'blue';
  if (value === 'REJECTED') return 'red';
  if (value === 'EXPIRED') return 'orange';
  return 'purple';
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(number) ? number : 0);
}

function dateLabel(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pl-PL').format(new Date(value));
}

async function readPayload(response: Response) {
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload.data;
}

export default function OffersWorkspace() {
  const [offers, setOffers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [configurations, setConfigurations] = useState<any[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [form, setForm] = useState<OfferForm>(emptyForm);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const pickerBg = useColorModeValue('white', 'navy.800');
  const pickerHoverBg = useColorModeValue('secondaryGray.50', 'whiteAlpha.100');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/offers?workspace=1', { cache: 'no-store' });
      const data = await readPayload(response);
      setOffers(data.offers || []);
      setProjects(data.projects || []);
      setConfigurations(data.configurations || []);
      setSelectedOfferId((current) => {
        if ((data.offers || []).some((offer: any) => offer.id === current)) return current;
        return data.offers?.[0]?.id || '';
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) || offers[0] || null;
  const configurationCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    configurations.forEach((configuration) => {
      counts.set(configuration.projectId, (counts.get(configuration.projectId) || 0) + 1);
    });
    return counts;
  }, [configurations]);
  const projectsWithConfigurations = useMemo(
    () => projects.filter((project) => configurationCountByProject.has(project.id)),
    [configurationCountByProject, projects],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [form.projectId, projects],
  );
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) return projectsWithConfigurations;
    return projectsWithConfigurations.filter((project) => {
      const haystack = [
        project.title,
        project.client?.displayName,
        project.client?.email,
        project.client?.phone,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [projectSearch, projectsWithConfigurations]);
  const projectConfigurations = useMemo(
    () => configurations.filter((configuration) => configuration.projectId === form.projectId),
    [configurations, form.projectId],
  );

  function updateForm(key: keyof OfferForm, value: string) {
    setForm((current) => {
      if (key === 'projectId') {
        const project = projects.find((item) => item.id === value);
        const energyAccount = project?.energyPortalAccounts?.[0];
        const energyOperator = energyAccount?.operator || current.energyOperator || 'ENEA';
        const configuration = configurations.find((item) => item.projectId === value);
        return {
          ...current,
          projectId: value,
          configurationId: configuration?.id || '',
          title: configuration?.name || '',
          energyOperator,
          tariffBefore: energyAccount?.tariff || getDefaultEnergyTariff(energyOperator),
          tariffAfter: getDefaultTargetEnergyTariff(energyOperator),
        };
      }
      if (key === 'energyOperator') {
        return {
          ...current,
          energyOperator: value,
          tariffBefore: getDefaultEnergyTariff(value),
          tariffAfter: getDefaultTargetEnergyTariff(value),
        };
      }
      if (key === 'configurationId') {
        const configuration = configurations.find((item) => item.id === value);
        return {
          ...current,
          configurationId: value,
          title: current.title || configuration?.name || '',
        };
      }
      return { ...current, [key]: value };
    });
  }

  function selectProject(projectId: string) {
    updateForm('projectId', projectId);
    setProjectPickerOpen(false);
    setProjectSearch('');
  }

  async function createOffer() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          subsidyGross: Number(form.subsidyGross || 0),
          thermoReliefGross: Number(form.thermoReliefGross || 0),
          currentAnnualBillGross: Number(form.currentAnnualBillGross || 0),
          projectedAnnualBillGross: Number(form.projectedAnnualBillGross || 0),
        }),
      });
      const offer = await readPayload(response);
      setOffers((current) => [offer, ...current]);
      setSelectedOfferId(offer.id);
      setNotice(`Utworzono ofertę ${offer.number}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(offerId: string, status: string) {
    setStatusSavingId(offerId);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/offers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: offerId, status }),
      });
      const offer = await readPayload(response);
      setOffers((current) => current.map((item) => (item.id === offer.id ? offer : item)));
      setNotice(`Zmieniono status oferty ${offer.number || ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusSavingId('');
    }
  }

  if (loading) {
    return (
      <Flex pt={{ base: '130px', md: '80px', xl: '80px' }} minH="50vh" align="center" justify="center">
        <Spinner />
      </Flex>
    );
  }

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', xl: 'row' }} justify="space-between" gap="16px" align={{ xl: 'center' }}>
          <Box>
            <Text color={mutedColor} fontWeight="700">Sprzedaż</Text>
            <Text color={textColor} fontSize="3xl" fontWeight="900">Oferty i umowy</Text>
            <Text color={mutedColor}>Tworzenie ofert z konfiguracji, statusy, wersje i podgląd PDF w stylu Reform.</Text>
          </Box>
          <Flex gap="10px" wrap="wrap">
            <Button leftIcon={<Icon as={MdRefresh} />} variant="outline" onClick={load}>
              Odśwież
            </Button>
            {selectedOffer ? (
              <Button
                as="a"
                href={`/offer-print/${selectedOffer.id}`}
                target="_blank"
                colorScheme="purple"
                leftIcon={<Icon as={MdPrint} />}
              >
                Drukuj / PDF
              </Button>
            ) : null}
          </Flex>
        </Flex>
      </Card>

      {error ? <Alert status="error" borderRadius="8px"><AlertIcon />{error}</Alert> : null}
      {notice ? <Alert status="success" borderRadius="8px"><AlertIcon />{notice}</Alert> : null}

      <Grid templateColumns={{ base: '1fr', '2xl': '430px 1fr' }} gap="20px" alignItems="start">
        <Flex direction="column" gap="20px">
          <Card p="22px">
            <Flex align="center" gap="10px" mb="18px">
              <Icon as={MdAdd} />
              <Text color={textColor} fontSize="lg" fontWeight="900">Nowa oferta</Text>
            </Flex>
            <Flex direction="column" gap="14px">
              <FormControl isRequired>
                <FormLabel>Projekt</FormLabel>
                <Box position="relative">
                  <Button
                    type="button"
                    variant="outline"
                    w="100%"
                    justifyContent="space-between"
                    rightIcon={<Icon as={MdKeyboardArrowDown} />}
                    onClick={() => setProjectPickerOpen((current) => !current)}
                  >
                    <Text noOfLines={1} textAlign="left" color={selectedProject ? textColor : mutedColor}>
                      {selectedProject
                        ? `${selectedProject.client?.displayName || 'Klient'} - ${selectedProject.title}`
                        : 'Wybierz projekt z konfiguracją'}
                    </Text>
                  </Button>
                  {projectPickerOpen ? (
                    <Box
                      position="absolute"
                      top="calc(100% + 8px)"
                      left="0"
                      right="0"
                      zIndex={20}
                      bg={pickerBg}
                      border="1px solid"
                      borderColor={borderColor}
                      borderRadius="8px"
                      boxShadow="xl"
                      p="10px"
                    >
                      <Input
                        autoFocus
                        value={projectSearch}
                        onChange={(event) => setProjectSearch(event.target.value)}
                        placeholder="Szukaj klienta lub projektu..."
                        mb="8px"
                      />
                      <Flex direction="column" maxH="260px" overflowY="auto" gap="4px">
                        {filteredProjects.length === 0 ? (
                          <Text color={mutedColor} fontSize="sm" px="8px" py="10px">
                            Brak projektów z konfiguracją dla tego wyszukiwania.
                          </Text>
                        ) : (
                          filteredProjects.map((project) => (
                            <Box
                              key={project.id}
                              as="button"
                              type="button"
                              textAlign="left"
                              borderRadius="6px"
                              px="10px"
                              py="9px"
                              bg={project.id === form.projectId ? pickerHoverBg : 'transparent'}
                              _hover={{ bg: pickerHoverBg }}
                              onClick={() => selectProject(project.id)}
                            >
                              <Text color={textColor} fontWeight="800" noOfLines={1}>
                                {project.client?.displayName || 'Klient'}
                              </Text>
                              <Flex justify="space-between" gap="10px" align="center">
                                <Text color={mutedColor} fontSize="sm" noOfLines={1}>
                                  {project.title || 'Projekt bez nazwy'}
                                </Text>
                                <Badge colorScheme="purple" flexShrink={0}>
                                  {configurationCountByProject.get(project.id) || 0} konf.
                                </Badge>
                              </Flex>
                            </Box>
                          ))
                        )}
                      </Flex>
                    </Box>
                  ) : null}
                </Box>
              </FormControl>
              <FormControl>
                <FormLabel>Konfiguracja</FormLabel>
                <Select value={form.configurationId} onChange={(event) => updateForm('configurationId', event.target.value)}>
                  <option value="">Bez konfiguracji</option>
                  {projectConfigurations.map((configuration) => (
                    <option key={configuration.id} value={configuration.id}>
                      {configuration.name} - {money(configuration.totalSaleGross)} PLN
                    </option>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>Tytuł oferty</FormLabel>
                <Input value={form.title} onChange={(event) => updateForm('title', event.target.value)} />
              </FormControl>
              <SimpleGrid columns={{ base: 1, md: 2, '2xl': 1 }} gap="12px">
                <FormControl>
                  <FormLabel>Ważna do</FormLabel>
                  <Input type="date" value={form.validUntil} onChange={(event) => updateForm('validUntil', event.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel>Dotacja brutto</FormLabel>
                  <Input type="number" value={form.subsidyGross} onChange={(event) => updateForm('subsidyGross', event.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel>Ulga termomodernizacyjna</FormLabel>
                  <Input type="number" value={form.thermoReliefGross} onChange={(event) => updateForm('thermoReliefGross', event.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel>Aktualny rachunek roczny</FormLabel>
                  <Input type="number" value={form.currentAnnualBillGross} onChange={(event) => updateForm('currentAnnualBillGross', event.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel>Prognozowany rachunek roczny</FormLabel>
                  <Input type="number" value={form.projectedAnnualBillGross} onChange={(event) => updateForm('projectedAnnualBillGross', event.target.value)} />
                </FormControl>
              </SimpleGrid>
              <SimpleGrid columns={{ base: 1, md: 2, '2xl': 1 }} gap="12px">
                <FormControl>
                  <FormLabel>OSD</FormLabel>
                  <Select value={form.energyOperator} onChange={(event) => updateForm('energyOperator', event.target.value)}>
                    {energyOperatorOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Taryfa przed</FormLabel>
                  <Select value={form.tariffBefore} onChange={(event) => updateForm('tariffBefore', event.target.value)}>
                    {getEnergyTariffs(form.energyOperator).map((tariff) => (
                      <option key={tariff.code} value={tariff.code}>{tariff.label}</option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Taryfa po</FormLabel>
                  <Select value={form.tariffAfter} onChange={(event) => updateForm('tariffAfter', event.target.value)}>
                    {getEnergyTariffs(form.energyOperator).map((tariff) => (
                      <option key={tariff.code} value={tariff.code}>{tariff.label}</option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Rozliczenie przed</FormLabel>
                  <Input value={form.settlementBefore} onChange={(event) => updateForm('settlementBefore', event.target.value)} />
                </FormControl>
              </SimpleGrid>
              <FormControl>
                <FormLabel>Opis PRZED</FormLabel>
                <Textarea value={form.descriptionBefore} onChange={(event) => updateForm('descriptionBefore', event.target.value)} rows={3} />
              </FormControl>
              <FormControl>
                <FormLabel>Opis PO</FormLabel>
                <Textarea value={form.descriptionAfter} onChange={(event) => updateForm('descriptionAfter', event.target.value)} rows={3} />
              </FormControl>
              <Button
                colorScheme="purple"
                leftIcon={<Icon as={MdAdd} />}
                onClick={createOffer}
                isLoading={saving}
                isDisabled={!form.projectId}
              >
                Utwórz ofertę
              </Button>
            </Flex>
          </Card>

          <Card p="22px">
            <Text color={textColor} fontSize="lg" fontWeight="900" mb="14px">Lista ofert</Text>
            {offers.length === 0 ? (
              <Text color={mutedColor}>Brak ofert. Utwórz pierwszą z konfiguracji projektu.</Text>
            ) : (
              <Flex direction="column" gap="10px">
                {offers.map((offer) => (
                  <Box
                    key={offer.id}
                    as="button"
                    type="button"
                    textAlign="left"
                    border="1px solid"
                    borderColor={selectedOffer?.id === offer.id ? 'purple.300' : borderColor}
                    bg={selectedOffer?.id === offer.id ? 'whiteAlpha.100' : 'transparent'}
                    borderRadius="8px"
                    p="12px"
                    onClick={() => setSelectedOfferId(offer.id)}
                  >
                    <Flex justify="space-between" gap="10px" align="start">
                      <Box minW="0">
                        <Text color={textColor} fontWeight="900" noOfLines={1}>{offer.number || 'Bez numeru'}</Text>
                        <Text color={mutedColor} fontSize="sm" noOfLines={1}>
                          {offer.project?.client?.displayName || '-'} - {offer.title || offer.project?.title || '-'}
                        </Text>
                      </Box>
                      <Badge colorScheme={statusColor(offer.status)}>{statusLabel(offer.status)}</Badge>
                    </Flex>
                    <Flex justify="space-between" align="center" gap="10px" mt="10px">
                      <Text color={textColor} fontWeight="800">{money(offer.totalGross)} PLN</Text>
                      <Text color={mutedColor} fontSize="sm">v{offer.version || 1} · {dateLabel(offer.updatedAt)}</Text>
                    </Flex>
                    <Flex gap="8px" align="center" mt="10px" onClick={(event) => event.stopPropagation()}>
                      <Select
                        size="sm"
                        value={offer.status || 'DRAFT'}
                        onChange={(event) => updateStatus(offer.id, event.target.value)}
                        isDisabled={statusSavingId === offer.id}
                      >
                        {offerStatuses.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                      <Tooltip label="Otwórz wydruk">
                        <IconButton
                          as="a"
                          href={`/offer-print/${offer.id}`}
                          target="_blank"
                          aria-label="Otwórz wydruk"
                          icon={<MdOpenInNew />}
                          size="sm"
                          variant="outline"
                        />
                      </Tooltip>
                    </Flex>
                  </Box>
                ))}
              </Flex>
            )}
          </Card>
        </Flex>

        <Card p="0" overflow="hidden">
          {selectedOffer ? (
            <OfferDocument offer={selectedOffer} compact />
          ) : (
            <Flex minH="360px" align="center" justify="center" p="30px">
              <Text color={mutedColor}>Wybierz ofertę, aby zobaczyć podgląd.</Text>
            </Flex>
          )}
        </Card>
      </Grid>
    </Flex>
  );
}
