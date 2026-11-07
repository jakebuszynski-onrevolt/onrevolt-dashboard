'use client';

import {
  Alert, AlertDescription, AlertIcon, Box, Button, Flex, Grid, IconButton,
  Spinner, Stack, Text, Tooltip, useColorModeValue,
} from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { MdArrowBack, MdArrowForward, MdAdd, MdRemove, MdDownload } from 'react-icons/md';
import type { OfferWorkspaceDocumentResult } from 'lib/onrevolt/offer-workspace-document';
import type { OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import {
  getOfferWorkspaceDocumentCache,
  isOfferWorkspaceDocumentKey,
  offerWorkspaceDocumentCacheScope,
  setOfferWorkspaceDocumentCache,
} from 'lib/onrevolt/offer-workspace-document-client-cache';
import type { WorkspaceData } from './OfferWorkspacePanel';

type Props = {
  workspace: WorkspaceData;
  draft: OfferWorkspaceDraft;
  templatePreview: boolean;
};

export const offerWorkspaceDocumentPreviewTemplateKey = 'REFORM_B2C/2026_10_V4';

const pageTitles = [
  'Dane klienta i obiektu', 'Opis proponowanego systemu', 'Roczny bilans · aktualnie',
  'Roczny bilans · z systemem', 'Maj · dzień roboczy', 'Maj · dzień wolny',
  'Styczeń · dzień roboczy', 'Styczeń · dzień wolny', 'Rachunki i oszczędności',
  'Konfiguracja i kosztorys',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDocumentResult(value: unknown): value is OfferWorkspaceDocumentResult {
  if (!isRecord(value) || value.pageCount !== 10 || !Array.isArray(value.pages) || value.pages.length !== 10
    || !Array.isArray(value.missingData) || !Array.isArray(value.suppressedCharts) || !Array.isArray(value.limitations)) return false;
  return value.pages.every((page, index) => isRecord(page) && page.page === index + 1 && typeof page.svg === 'string')
    && value.missingData.every((item) => isRecord(item) && typeof item.page === 'number'
      && Array.isArray(item.fieldKeys) && typeof item.idHint === 'string' && typeof item.reason === 'string');
}

export async function readDocumentResponse(response: Response): Promise<OfferWorkspaceDocumentResult> {
  const parsed = await readDocumentResponseEnvelope(response);
  if (parsed.notModified === true) throw new Error('Serwer potwierdził zapisany dokument, którego nie ma w pamięci.');
  return parsed.document;
}

export type OfferWorkspaceDocumentResponse =
  | { notModified: true; documentKey: string }
  | { notModified: false; document: OfferWorkspaceDocumentResult; documentKey?: string };

export async function readDocumentResponseEnvelope(response: Response): Promise<OfferWorkspaceDocumentResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Serwer zwrócił nieprawidłową odpowiedź podglądu.');
  }

  const envelope = isRecord(body) ? body : {};
  const wrappedData = 'data' in envelope ? envelope.data : body;
  const errorData = isRecord(wrappedData) ? wrappedData : {};
  const message = typeof envelope.error === 'string' ? envelope.error
    : typeof errorData.error === 'string' ? errorData.error : `Błąd żądania (${response.status}).`;
  if (!response.ok || envelope.ok === false) throw new Error(message);

  const data = isRecord(wrappedData) ? wrappedData : {};
  const documentKey = data.documentKey ?? envelope.documentKey;
  if (documentKey !== undefined && !isOfferWorkspaceDocumentKey(documentKey)) {
    throw new Error('Serwer zwrócił nieprawidłowy klucz dokumentu.');
  }
  if (data.notModified === true) {
    if (typeof documentKey !== 'string') throw new Error('Serwer nie zwrócił klucza potwierdzonego dokumentu.');
    return { notModified: true, documentKey };
  }

  const result = 'document' in data ? data.document : wrappedData;
  if (!isDocumentResult(result)) throw new Error('Serwer nie zwrócił kompletnego dokumentu SVG (10 stron).');
  if (result.templateKey !== offerWorkspaceDocumentPreviewTemplateKey) {
    throw new Error('Podgląd oferty wymaga szablonu REFORM_B2C/2026_10_V4.');
  }
  return typeof documentKey === 'string'
    ? { notModified: false, document: result, documentKey }
    : { notModified: false, document: result };
}

export const offerWorkspaceDocumentAspectRatio = 595 / 843;
export const offerWorkspaceDocumentFrameStyle = Object.freeze({
  position: 'absolute' as const,
  inset: 0,
  width: '100%',
  height: '100%',
  border: 0,
});

export function svgSrcDoc(svg: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; object-src 'none'; frame-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;overflow:hidden}svg{display:block;width:100%;height:auto}</style></head><body style="background:#fff">${svg}</body></html>`;
}

export function createOfferWorkspaceDocumentRequest(workspace: WorkspaceData, draft: OfferWorkspaceDraft, templatePreview: boolean) {
  return templatePreview
    ? { endpoint: '/offer-workspace-preview/document', body: { workspace, draft } }
    : { endpoint: `/api/projects/${encodeURIComponent(workspace.projectId)}/offer-workspace/document`, body: { draft, sourceRevision: workspace.revision } };
}

function DocumentFrame({ svg, title, thumbnail = false }: { svg: string; title: string; thumbnail?: boolean }) {
  return <Box position="relative" w="100%" minW="0" aspectRatio={offerWorkspaceDocumentAspectRatio} overflow="hidden" bg="white">
    <iframe title={title} srcDoc={svgSrcDoc(svg)} sandbox="" referrerPolicy="no-referrer" loading="lazy" tabIndex={thumbnail ? -1 : undefined}
      style={thumbnail ? { ...offerWorkspaceDocumentFrameStyle, pointerEvents: 'none' } : offerWorkspaceDocumentFrameStyle} />
  </Box>;
}

const format = (value: number | null | undefined) => value == null
  ? '—'
  : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(value);

export default function OfferWorkspaceDocumentPreview({ workspace, draft, templatePreview }: Props) {
  const [loadedDocument, setLoadedDocument] = useState<{ requestKey: string; document: OfferWorkspaceDocumentResult } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [downloading, setDownloading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pages = useRef<Array<HTMLDivElement | null>>([]);
  // Server document inputs do not include transient energy/valuation loading state or the open menu.
  const { step: _step, ...documentDraft } = draft;
  const requestKey = JSON.stringify(templatePreview
    ? { workspace, draft: documentDraft }
    : { actorId: workspace.viewerId, projectId: workspace.projectId, sourceRevision: workspace.revision, draft: documentDraft, documentRevision: workspace.documentRevision });
  const document = loadedDocument?.requestKey === requestKey ? loadedDocument.document : null;
  const colors = {
    line: useColorModeValue('#e0e5f2', 'whiteAlpha.200'),
    muted: useColorModeValue('#8392b4', 'gray.400'),
    surface: useColorModeValue('white', 'navy.800'),
    soft: useColorModeValue('#f5f7fd', 'whiteAlpha.50'),
  };

  useEffect(() => {
    const controller = new AbortController();
    const { endpoint, body } = createOfferWorkspaceDocumentRequest(workspace, draft, templatePreview);

    setLoadedDocument(null);
    setError('');
    setLoading(true);
    setPage(1);
    pages.current = [];

    void (async () => {
      try {
        const cacheScope = templatePreview ? null : offerWorkspaceDocumentCacheScope(workspace.viewerId, workspace.projectId);
        const cached = await getOfferWorkspaceDocumentCache(cacheScope);
        if (controller.signal.aborted) return;
        const requestBody = cached && !templatePreview ? { ...body, knownDocumentKey: cached.documentKey } : body;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = await readDocumentResponseEnvelope(response);
        if (controller.signal.aborted) return;
        if (result.notModified === true) {
          if (!cached || cached.documentKey !== result.documentKey) {
            throw new Error('Serwer potwierdził zapisany dokument, którego nie ma w lokalnej pamięci. Ponów podgląd.');
          }
          setLoadedDocument({ requestKey, document: cached.document });
        } else {
          setLoadedDocument({ requestKey, document: result.document });
          if (result.documentKey && cacheScope) {
            setOfferWorkspaceDocumentCache(cacheScope, { documentKey: result.documentKey, document: result.document });
          }
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'Nie udało się wygenerować podglądu dokumentu.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [requestKey, templatePreview]);

  function navigate(target: number) {
    setPage(target);
    const targetPage = pages.current[target - 1];
    if (!root.current || !targetPage) return;
    root.current.scrollTo({
      top: root.current.scrollTop + targetPage.getBoundingClientRect().top - root.current.getBoundingClientRect().top - 18,
      behavior: 'smooth',
    });
  }

  function changeZoom(delta: number) {
    const currentPage = page;
    setZoom((value) => Math.max(60, Math.min(180, value + delta)));
    window.requestAnimationFrame(() => navigate(currentPage));
  }

  async function downloadPdf() {
    setDownloading(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(workspace.projectId)}/offer-workspace/document`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, format: 'pdf-draft', sourceRevision: workspace.revision }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Nie udało się pobrać PDF.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `oferta-robocza-${workspace.projectId}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się pobrać PDF.'); }
    finally { setDownloading(false); }
  }

  return <>
    {loading ? <Alert status="info" borderRadius="8px" mb="14px" aria-live="polite">
      <AlertIcon /><Spinner size="sm" mr="10px" /><AlertDescription>Generowanie podglądu dokumentu SVG…</AlertDescription>
    </Alert> : null}
    {error ? <Alert status="error" borderRadius="8px" mb="14px" aria-live="polite"><AlertIcon />{error}</Alert> : null}
    {document?.missingData.length ? <Alert status="warning" borderRadius="8px" mb="14px">
      <AlertIcon /><AlertDescription>Podgląd roboczy. Brakuje części danych i wyników kalkulacji; niewyliczone wartości oznaczono jako —.</AlertDescription>
    </Alert> : null}

    <Flex justify="space-between" gap="10px" wrap="wrap" my="16px" align="center">
      <Flex align="center" gap="10px">
        <Tooltip label="Poprzednia strona"><IconButton aria-label="Poprzednia strona" size="sm" variant="outline" icon={<MdArrowBack />} isDisabled={!document || page === 1} onClick={() => navigate(page - 1)} /></Tooltip>
        <Text fontSize="12px">Strona {page} / {document?.pageCount ?? 10}</Text>
        <Tooltip label="Następna strona"><IconButton aria-label="Następna strona" size="sm" variant="outline" icon={<MdArrowForward />} isDisabled={!document || page === (document?.pageCount ?? 10)} onClick={() => navigate(page + 1)} /></Tooltip>
      </Flex>
      <Flex align="center" gap="10px">
        <Tooltip label="Pomniejsz dokument"><IconButton aria-label="Pomniejsz dokument" size="sm" variant="outline" icon={<MdRemove />} isDisabled={!document || zoom <= 60} onClick={() => changeZoom(-10)} /></Tooltip>
        <Text fontSize="12px" minW="42px" textAlign="center">{zoom}%</Text>
        <Tooltip label="Powiększ dokument"><IconButton aria-label="Powiększ dokument" size="sm" variant="outline" icon={<MdAdd />} isDisabled={!document || zoom >= 180} onClick={() => changeZoom(10)} /></Tooltip>
        <Button size="sm" variant="outline" leftIcon={<MdDownload />} isDisabled={!document || loading || templatePreview} isLoading={downloading} onClick={downloadPdf}>Pobierz PDF roboczy</Button>
      </Flex>
    </Flex>

    <Grid templateColumns={{ base: 'minmax(0,1fr)', md: '125px minmax(0,1fr)' }} gap="16px">
      <Box as="aside" aria-label="Strony oferty" display={{ base: 'flex', md: 'block' }} overflow="auto" h={{ base: 'auto', md: '780px' }} maxW="100%" gap="8px" pb="8px">
        {document?.pages.map((item) => {
          const title = pageTitles[item.page - 1] || `Strona ${item.page}`;
          return <Button key={item.page} display="block" h="auto" whiteSpace="normal" w={{ base: '88px', md: '100%' }} flexShrink={0} mb={{ base: 0, md: '10px' }} p="6px" variant="outline" borderRadius="8px" borderColor={page === item.page ? '#8a47ff' : colors.line} bg={page === item.page ? colors.soft : colors.surface} aria-label={`Strona ${item.page}: ${title}`} aria-current={page === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}>
            <DocumentFrame svg={item.svg} title={`Miniatura strony ${item.page}`} thumbnail />
            <Text mt="6px" fontSize="10px" fontWeight="500">{item.page}. {title}</Text>
          </Button>;
        })}
      </Box>
      <Box ref={root} tabIndex={0} aria-label="Przewijany dokument oferty" h={{ base: '600px', md: '780px' }} overflow="auto" bg={colors.soft} borderRadius="8px" p={{ base: '8px', md: '22px' }} minW="0" onScroll={() => {
        if (!root.current || !document) return;
        if (root.current.scrollTop >= root.current.scrollHeight - root.current.clientHeight - 5) { setPage(document.pageCount); return; }
        const top = root.current.getBoundingClientRect().top;
        const index = pages.current.findIndex((paper) => paper && paper.getBoundingClientRect().bottom > top + 50);
        if (index >= 0) setPage(index + 1);
      }}>
        {document ? document.pages.map((item) => {
          const title = pageTitles[item.page - 1] || `Strona ${item.page}`;
          return <Box key={item.page} ref={(element: HTMLDivElement | null) => { pages.current[item.page - 1] = element; }} as="article" w={`${zoom}%`} minW="0" mx="auto" mb="20px" bg="white">
            <DocumentFrame svg={item.svg} title={`Podgląd strony ${item.page}: ${title}`} />
            <Flex justify="space-between" p="8px" color={colors.muted} fontSize="10px"><Text>{title}</Text><Text>{item.page} / {document.pageCount}</Text></Flex>
          </Box>;
        }) : <Flex minH="360px" align="center" justify="center" color={colors.muted} textAlign="center" px="20px">
          {loading ? 'Oczekiwanie na wyrenderowane strony SVG.' : error ? 'Podgląd nie jest dostępny.' : 'Brak wygenerowanego dokumentu.'}
        </Flex>}
      </Box>
    </Grid>

    {document ? <>
      <Box as="details" mt="24px" borderTop="1px solid" borderColor={colors.line} pt="16px">
        <Box as="summary" cursor="pointer" fontWeight="700">Brakujące dane i ograniczenia · {document.missingData.length}</Box>
        <Stack spacing="12px" mt="16px">
          {document.missingData.length ? document.missingData.map((item, index) => <Box key={`${item.page}-${item.idHint}-${index}`} borderLeft="2px solid" borderColor="orange.400" pl="12px">
            <Text fontWeight="700">Strona {item.page}: {pageTitles[item.page - 1] || `Strona ${item.page}`} · {item.idHint}</Text>
            <Text mt="2px">{item.reason}</Text>
            {item.fieldKeys.length ? <Text mt="2px" color={colors.muted} overflowWrap="anywhere">Pola: {item.fieldKeys.join(', ')}</Text> : null}
          </Box>) : <Text color={colors.muted}>Renderer nie zgłosił brakujących pól.</Text>}
          {document.suppressedCharts.map((item) => <Text key={`${item.page}-${item.reason}`} color={colors.muted}>Strona {item.page}: {item.reason}</Text>)}
          {document.limitations.map((item, index) => <Text key={`${index}-${item}`} color={colors.muted}>{item}</Text>)}
        </Stack>
      </Box>
      <Box as="details" mt="16px" borderTop="1px solid" borderColor={colors.line} pt="16px">
        <Box as="summary" cursor="pointer" fontWeight="700">Dane szkicu</Box>
        <Stack spacing="10px" mt="16px">
          <Text>{workspace.clientName} · {workspace.projectName}</Text>
          <Text>PV: {format(draft.existingPv.powerKw)} kWp · nachylenie {format(draft.existingPv.tiltDegrees)}° · azymut {format(draft.existingPv.azimuthDegrees)}°</Text>
          <Text fontWeight="700">Wybrane zestawy katalogowe</Text>
          {workspace.templates.filter((item) => draft.selectedTemplateIds.includes(item.id)).map((item) => <Text key={item.id}>{item.name} · wersja {item.version}{item.items.some((position) => position.requiresReview) ? ' · wymaga weryfikacji' : ''}</Text>)}
          <Text>Dotacja: {draft.financing.considerGrant ? 'kwalifikowalność do potwierdzenia' : 'nie uwzględniaj'} · Ulga: {draft.financing.considerTaxRelief ? 'uprawnienie do potwierdzenia' : 'nie uwzględniaj'}</Text>
        </Stack>
      </Box>
    </> : null}
  </>;
}
