'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Badge,
    Box,
    Button,
    Flex,
    Heading,
    HStack,
    Input,
    Select,
    Spinner,
    Table,
    Tbody,
    Td,
    Th,
    Thead,
    Tr,
    Text,
    useToast,
    VStack,
    Progress,            // <-- NOWE
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useRouter, useSearchParams } from 'next/navigation';

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, ''); // np. "/panel";

// ---- typy danych zgodne z /api/pipedrive/compare-typeform ----

type PdType = 'varchar' | 'text' | 'double' | 'enum' | 'set' | 'phone' | 'date';

type TfMapped = {
    ref: string;
    title: string;
    tf_type: string;      // TypeformField (short_text, yes_no itd.)
    pd_type: PdType;      // typ pola w PD
    options?: string[];
    suggested_name: string; // "raport_*" – nazwa docelowa w Pipedrive
};

type PdField = {
    id: number;
    key: string;          // systemowy klucz PD (hash / value / org_id...)
    name: string;         // nazwa pola w PD (np. "raport_metry")
    field_type: PdType;
    options?: string[];
};

type CompareResponse = {
    form: { id: string; title: string };
    entity: 'deal' | 'person';
    typeform_fields: TfMapped[];
    pipedrive_fields: PdField[];
    missing_on_pipedrive: any[];
    missing?: any[];
    naming_convention: string;
};

// odpowiedź chunkowego endpointu copy-field-values
type CopyChunkResponse = {
    moved: number;
    processed: number;
    hasMore: boolean;
    nextStart: number | null;
};

export default function Page() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const toast = useToast();

    const defaultFormId = process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID || '';

    const [formId, setFormId] = useState<string>(
        searchParams.get('form_id') || defaultFormId
    );
    const [entity, setEntity] = useState<'deal' | 'person'>(
        (searchParams.get('entity') as any) || 'deal'
    );

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [pdFields, setPdFields] = useState<PdField[]>([]);
    const [tfFields, setTfFields] = useState<TfMapped[]>([]);
    const [formTitle, setFormTitle] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [fromKey, setFromKey] = useState<string>('');
    const [toKey, setToKey] = useState<string>('');

    // STAN KOPIOWANIA + PROGRESS
    const [isCopying, setIsCopying] = useState(false);
    const [progress, setProgress] = useState(0);

    const query = useMemo(
        () =>
            `${BASE}/api/pipedrive/compare-typeform?form_id=${encodeURIComponent(
                formId
            )}&entity=${entity}`,
        [formId, entity]
    );

    // ---- helpery ----

    // nazwa pola do wyświetlania
    function getPdDisplayName(field: PdField): string {
        return field.name || field.key;
    }

    function getPdDisplayType(field: PdField): string {
        return field.field_type || '';
    }

    // Set nazw "raport_*" z TF
    const tfSuggestedNames = useMemo(
        () => new Set(tfFields.map((f) => f.suggested_name)),
        [tfFields]
    );

    // czy dane pole PD jest mapą z Typeformu?
    function isFieldFromTypeform(field: PdField): boolean {
        return tfSuggestedNames.has(field.name);
    }

    // filtr wyszukiwania
    const filteredPdFields = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return pdFields;
        return pdFields.filter((f) => {
            const name = getPdDisplayName(f).toLowerCase();
            const key = f.key.toLowerCase();
            return name.includes(q) || key.includes(q);
        });
    }, [pdFields, search]);

    // ---- ładowanie danych ----

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const r = await fetch(query, { cache: 'no-store' });
            if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);

            const data: CompareResponse = await r.json();
            setPdFields(data.pipedrive_fields || []);
            setTfFields(data.typeform_fields || []);
            setFormTitle(data.form?.title || null);

            setFromKey('');
            setToKey('');
        } catch (e: any) {
            setError(e?.message || 'Nie udało się pobrać danych.');
        } finally {
            setLoading(false);
        }
    }

    // aktualizacja query w URL
    useEffect(() => {
        const usp = new URLSearchParams(searchParams.toString());
        usp.set('form_id', formId);
        usp.set('entity', entity);
        router.replace(`?${usp.toString()}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formId, entity]);

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    // ---- akcja kopiowania danych między polami PD (chunkowa) ----

    async function handleCopy() {
        if (!fromKey || !toKey) {
            toast({
                title: 'Wybierz oba pola',
                description: 'Musisz wskazać stare pole (źródło) i nowe pole (docelowe).',
                status: 'warning',
                duration: 4000,
            });
            return;
        }
        if (fromKey === toKey) {
            toast({
                title: 'Te same pola',
                description: 'Pole źródłowe i docelowe nie mogą być takie same.',
                status: 'warning',
                duration: 4000,
            });
            return;
        }

        let start = 0;
        let totalMoved = 0;
        let iteration = 0;

        setIsCopying(true);
        setProgress(0);

        try {
            // pętla po „chunkach” aż hasMore === false
            for (; ;) {
                iteration++;

                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 15000); // 15s timeout

                const res = await fetch(`${BASE}/api/pipedrive/copy-field-values`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        entity,
                        from_key: fromKey,
                        to_key: toKey,
                        start,
                    }),
                });

                clearTimeout(timer);

                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`${res.status} ${txt}`);
                }

                const data: CopyChunkResponse = await res.json();

                totalMoved += data.moved ?? 0;

                // postęp przybliżony – rośnie z każdą paczką
                setProgress((prev) => {
                    if (!data.hasMore) return 100;
                    // max 95%, ostatni chunk dobije do 100
                    const next = prev + 10;
                    return next > 95 ? 95 : next;
                });

                if (!data.hasMore) {
                    break;
                }

                if (data.nextStart != null) {
                    start = data.nextStart;
                } else {
                    // fallback – jakby Pipedrive nie podał nextStart
                    start = start + (data.processed || 500);
                }
            }

            const fromField = pdFields.find((f) => f.key === fromKey);
            const toField = pdFields.find((f) => f.key === toKey);

            toast({
                title: 'Kopiowanie zakończone',
                description: `Przepisano ${totalMoved} rekordów z pola "${fromField?.name ?? fromKey}" do pola "${toField?.name ?? toKey}".`,
                status: 'success',
                duration: 7000,
            });
        } catch (e: any) {
            toast({
                title: 'Błąd kopiowania',
                description: e?.message || 'Nie udało się skopiować danych pól.',
                status: 'error',
                duration: 7000,
            });
        } finally {
            setIsCopying(false);
            setProgress(0);
        }
    }

    // render opcji w Select
    function renderOption(field: PdField) {
        const displayName = getPdDisplayName(field);
        const type = getPdDisplayType(field);

        const fromTf = isFieldFromTypeform(field);

        const isHashKey = /^[0-9a-f]{24,}$/i.test(field.key);
        const keySuffix = isHashKey ? '' : ` — ${field.key}`;

        return (
            <option key={field.key} value={field.key}>
                {displayName}
                {type ? ` (${type})` : ''}
                {keySuffix}
                {fromTf ? ' [TF]' : ''}
            </option>
        );
    }

    const usedPdFields = useMemo(
        () => pdFields.filter(isFieldFromTypeform),
        [pdFields, tfSuggestedNames]
    );

    // ---- UI ----

    return (
        <Flex direction="column" pt={{ sm: '125px', lg: '75px' }}>
            <Card px="24px" py="24px" mb="16px">
                <HStack justify="space-between" align="center" wrap="wrap" gap={4}>
                    <Box>
                        <Heading size="md">Fields Organizing</Heading>
                        {formTitle && (
                            <Text fontSize="sm" color="gray.400">
                                Formularz: {formTitle} ({formId})
                            </Text>
                        )}
                    </Box>

                    <HStack>
                        <Box>
                            <Text fontSize="sm" mb="1">
                                Form ID
                            </Text>
                            <Select
                                size="sm"
                                value={formId}
                                onChange={(e) => setFormId(e.target.value)}
                                minW="260px"
                            >
                                <option value={defaultFormId}>{defaultFormId}</option>
                                {/* jeśli masz więcej formularzy, dodaj je tutaj */}
                            </Select>
                        </Box>

                        <Box>
                            <Text fontSize="sm" mb="1">
                                Entity
                            </Text>
                            <Select
                                size="sm"
                                value={entity}
                                onChange={(e) => setEntity(e.target.value as any)}
                                minW="140px"
                            >
                                <option value="deal">deal</option>
                                <option value="person">person</option>
                            </Select>
                        </Box>

                        <Button size="sm" onClick={load} isLoading={loading || isCopying}>
                            Refresh
                        </Button>
                    </HStack>
                </HStack>

                <Text mt="8px" fontSize="sm" color="gray.400">
                    Ta strona służy do porządkowania pól w Pipedrive. Wybierz{' '}
                    <b>stare pole</b> (źródło) oraz <b>nowe pole</b> (docelowe), żeby
                    przepisać dane. Pola oznaczone{' '}
                    <Badge ml="4px" colorScheme="green">
                        TF
                    </Badge>{' '}
                    to pola, których nazwa (<code>name</code>) dokładnie odpowiada
                    sugerowanej nazwie <code>raport_*</code> z Typeform.
                </Text>
            </Card>

            <Card px="24px" py="24px">
                {loading && !isCopying && (
                    <Flex align="center" gap="10px">
                        <Spinner /> <Text>Ładowanie danych…</Text>
                    </Flex>
                )}

                {!loading && error && (
                    <Box>
                        <Text color="red.400">{error}</Text>
                    </Box>
                )}

                {!loading && !error && (
                    <VStack align="stretch" spacing={4}>
                        {/* filtr */}
                        <Box>
                            <Text fontSize="sm" mb="1">
                                Filtruj pola (po nazwie / key)
                            </Text>
                            <Input
                                size="sm"
                                placeholder="np. raport_metry"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </Box>

                        {/* wybór pól */}
                        <HStack align="flex-start" spacing={6} flexWrap="wrap">
                            <Box flex="1 1 260px" minW="260px">
                                <Text fontWeight="semibold" mb="1">
                                    Stare pole (źródło)
                                </Text>
                                <Select
                                    size="sm"
                                    value={fromKey}
                                    onChange={(e) => setFromKey(e.target.value)}
                                    isDisabled={isCopying}
                                >
                                    <option value="">— wybierz stare pole —</option>
                                    {filteredPdFields.map(renderOption)}
                                </Select>
                            </Box>

                            <Box flex="1 1 260px" minW="260px">
                                <Text fontWeight="semibold" mb="1">
                                    Nowe pole (docelowe)
                                </Text>
                                <Select
                                    size="sm"
                                    value={toKey}
                                    onChange={(e) => setToKey(e.target.value)}
                                    isDisabled={isCopying}
                                >
                                    <option value="">— wybierz nowe pole —</option>
                                    {filteredPdFields.map(renderOption)}
                                </Select>
                            </Box>
                        </HStack>

                        {/* przycisk kopiowania + progress */}
                        <Box pt={2}>
                            <Button
                                colorScheme="blue"
                                onClick={handleCopy}
                                isDisabled={!fromKey || !toKey || loading || isCopying}
                            >
                                {isCopying ? 'Kopiowanie…' : 'Skopiuj dane (stare → nowe)'}
                            </Button>

                            {fromKey && toKey && fromKey !== toKey && (
                                <Text mt="2" fontSize="xs" color="gray.400">
                                    Dane z pola{' '}
                                    <b>{pdFields.find((f) => f.key === fromKey)?.name ?? fromKey}</b>{' '}
                                    zostaną przepisane do pola{' '}
                                    <b>{pdFields.find((f) => f.key === toKey)?.name ?? toKey}</b>.
                                    Kopiujemy tylko tam, gdzie nowe pole jest puste, a stare ma
                                    wartość.
                                </Text>
                            )}

                            {isCopying && (
                                <Box mt={3}>
                                    <Text fontSize="xs" color="gray.400" mb={1}>
                                        Trwa kopiowanie danych w paczkach… (to może chwilę potrwać)
                                    </Text>
                                    <Progress size="sm" isIndeterminate value={progress} />
                                </Box>
                            )}
                        </Box>

                        {/* podgląd pól PD, które są z TF */}
                        <Box pt={4}>
                            <Heading size="sm" mb={3}>
                                Pola Pipedrive powiązane z Typeform
                            </Heading>
                            <Text fontSize="sm" color="gray.400" mb={3}>
                                Lista pól w Pipedrive, których nazwa pokrywa się z sugerowanymi
                                nazwami <code>raport_*</code> z Typeform. Dzięki temu łatwo
                                widzisz, które pola są „aktualne”.
                            </Text>

                            {usedPdFields.length === 0 ? (
                                <Text fontSize="sm" color="gray.500">
                                    Nie znaleziono pól Pipedrive, których nazwy odpowiadałyby
                                    polom z Typeform dla tego formularza / entity.
                                </Text>
                            ) : (
                                <Table size="sm" variant="simple">
                                    <Thead>
                                        <Tr>
                                            <Th>NAZWA (PD)</Th>
                                            <Th>KEY</Th>
                                            <Th>TYP</Th>
                                            <Th>TF?</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {usedPdFields.map((f) => (
                                            <Tr key={f.key}>
                                                <Td>{getPdDisplayName(f)}</Td>
                                                <Td fontFamily="mono" fontSize="xs">
                                                    {f.key}
                                                </Td>
                                                <Td>{getPdDisplayType(f)}</Td>
                                                <Td>
                                                    <Badge colorScheme="green">TF</Badge>
                                                </Td>
                                            </Tr>
                                        ))}
                                    </Tbody>
                                </Table>
                            )}
                        </Box>
                    </VStack>
                )}
            </Card>
        </Flex>
    );
}
