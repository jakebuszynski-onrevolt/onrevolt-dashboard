'use client';

import { Alert, AlertIcon, Avatar, Badge, Box, Button, Flex, FormControl, FormLabel, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Spinner, Text, useColorModeValue } from '@chakra-ui/react';
import Card from 'components/card/Card';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdOpenInNew, MdRefresh } from 'react-icons/md';

type MoveState = { project: any; stage: any } | null;

function inputDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 16);
}

function shortDate(value?: string | null) {
  if (!value) return 'Brak terminu';
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function PipelineWorkspace() {
  const [data, setData] = useState<any>({ columns: [], users: [] });
  const [query, setQuery] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [move, setMove] = useState<MoveState>(null);
  const [moveOwnerId, setMoveOwnerId] = useState('');
  const [nextActionTitle, setNextActionTitle] = useState('');
  const [nextActionAt, setNextActionAt] = useState('');
  const [saving, setSaving] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const columnBg = useColorModeValue('secondaryGray.100', 'navy.900');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (ownerId) params.set('ownerId', ownerId);
      const response = await fetch(`/api/crm/pipeline?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setData(payload.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ownerId, query]);

  useEffect(() => {
    const timeout = window.setTimeout(load, 250);
    return () => window.clearTimeout(timeout);
  }, [load]);

  function beginMove(project: any, stageId: string) {
    const stage = data.columns.find((column: any) => column.stage.id === stageId)?.stage;
    if (!stage || stage.id === project.stageId) return;
    setMove({ project, stage });
    setMoveOwnerId(project.ownerId || '');
    setNextActionTitle(project.nextActionTitle || '');
    setNextActionAt(inputDate(project.nextActionAt));
  }

  async function saveMove() {
    if (!move) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/crm/projects/transition', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: move.project.id,
          stageId: move.stage.id,
          ownerId: moveOwnerId,
          nextActionTitle,
          nextActionAt: nextActionAt || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setMove(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function scrollToStage(stageId: string) {
    const column = document.getElementById(`pipeline-stage-${stageId}`);
    const board = boardRef.current;
    if (!column || !board) return;
    board.scrollTo({ left: Math.max(0, column.offsetLeft - board.offsetLeft - 12), behavior: 'smooth' });
  }

  const maximumCount = Math.max(1, ...data.columns.map((column: any) => Number(column.count || 0)));

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px' }} gap="16px">
      <Flex direction={{ base: 'column', lg: 'row' }} align={{ lg: 'center' }} gap="12px">
        <Box flex="1"><Text color={textColor} fontSize="2xl" fontWeight="800">Lejek sprzedaży</Text><Text color={mutedColor}>Projekty według etapu</Text></Box>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj klienta lub projektu" maxW="340px" />
        <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} maxW="240px"><option value="">Wszyscy właściciele</option>{data.users.map((user: any) => <option key={user.id} value={user.id}>{user.name}</option>)}</Select>
        <Button leftIcon={<MdRefresh />} variant="outline" onClick={load} isLoading={loading}>Odśwież</Button>
      </Flex>
      {error ? <Alert status="error" borderRadius="8px"><AlertIcon />{error}</Alert> : null}
      {data.columns.length ? (
        <Box overflowX="auto" pb="4px">
          <Flex minW="max-content" gap="6px" align="end" h="112px" px="2px">
            {data.columns.map((column: any) => {
              const height = 10 + Math.round((Number(column.count || 0) / maximumCount) * 42);
              return (
                <Box
                  as="button"
                  type="button"
                  key={column.stage.id}
                  w="116px"
                  h="104px"
                  display="flex"
                  flexDirection="column"
                  justifyContent="end"
                  textAlign="left"
                  onClick={() => scrollToStage(column.stage.id)}
                  aria-label={`Przejdź do etapu ${column.stage.name}`}
                >
                  <Text color={textColor} fontSize="xl" fontWeight="900" lineHeight="1">{column.count}</Text>
                  <Text color={mutedColor} fontSize="xs" noOfLines={2} minH="30px" mt="3px">{column.stage.name}</Text>
                  <Box h={`${height}px`} mt="5px" bg={column.stage.color || 'purple.400'} borderTopRadius="4px" opacity={column.count ? 1 : 0.28} transition="height .2s ease" />
                </Box>
              );
            })}
          </Flex>
        </Box>
      ) : null}
      {loading && !data.columns.length ? <Flex justify="center" py="80px"><Spinner /></Flex> : (
        <Flex ref={boardRef} gap="10px" overflowX="auto" align="stretch" pb="12px" scrollBehavior="smooth">
          {data.columns.map((column: any) => (
            <Box id={`pipeline-stage-${column.stage.id}`} key={column.stage.id} bg={columnBg} borderRadius="8px" p="9px" minW="210px" w="210px" maxH="calc(100vh - 320px)" overflowY="auto">
              <Flex position="sticky" top="-10px" bg={columnBg} zIndex="1" py="10px" justify="space-between" align="center">
                <Flex align="center" gap="8px"><Box w="8px" h="8px" borderRadius="50%" bg={column.stage.color || 'purple.400'} /><Text color={textColor} fontWeight="800" fontSize="sm">{column.stage.name}</Text></Flex>
                <Badge>{column.count}</Badge>
              </Flex>
              <Flex direction="column" gap="10px">
                {column.projects.map((project: any) => (
                  <Card key={project.id} p="12px" border="1px solid" borderColor={borderColor} boxShadow="none">
                    <Flex justify="space-between" gap="8px" align="start">
                      <Box minW="0"><Text color={textColor} fontWeight="800" noOfLines={1}>{project.client.displayName}</Text><Text color={mutedColor} fontSize="sm" noOfLines={2}>{project.title}</Text></Box>
                      <Button as={Link} href={`/admin/clients/${project.clientId}?projectId=${project.id}`} size="xs" variant="ghost" aria-label="Otwórz projekt"><MdOpenInNew /></Button>
                    </Flex>
                    <Flex align="center" gap="8px" mt="10px"><Avatar size="xs" name={project.owner?.name || '?'} src={project.owner?.avatarUrl || undefined} /><Text color={mutedColor} fontSize="xs">{project.owner?.name || 'Nieprzypisany'}</Text></Flex>
                    <Box mt="10px"><Text color={mutedColor} fontSize="xs">{project.nextActionTitle || 'Brak następnego działania'}</Text><Text color={project.nextActionAt && new Date(project.nextActionAt) < new Date() ? 'red.400' : mutedColor} fontSize="xs" fontWeight="700">{shortDate(project.nextActionAt)}</Text></Box>
                    <Select mt="10px" size="sm" value={project.stageId || ''} onChange={(event) => beginMove(project, event.target.value)} aria-label={`Zmień etap ${project.title}`}>{data.columns.map((target: any) => <option key={target.stage.id} value={target.stage.id}>{target.stage.name}</option>)}</Select>
                  </Card>
                ))}
                {column.count > column.projects.length ? <Text color={mutedColor} textAlign="center" fontSize="xs">{column.projects.length} z {column.count}</Text> : null}
              </Flex>
            </Box>
          ))}
        </Flex>
      )}

      <Modal isOpen={Boolean(move)} onClose={() => setMove(null)} size="lg">
        <ModalOverlay />
        <ModalContent borderRadius="8px">
          <ModalHeader>{move?.stage.name}</ModalHeader><ModalCloseButton />
          <ModalBody><Flex direction="column" gap="14px">
            <FormControl isRequired={move?.stage.requiresOwner}><FormLabel>Właściciel</FormLabel><Select value={moveOwnerId} onChange={(event) => setMoveOwnerId(event.target.value)}><option value="">Nieprzypisany</option>{data.users.map((user: any) => <option key={user.id} value={user.id}>{user.name}</option>)}</Select></FormControl>
            {move?.stage.requiresNextAction ? <><FormControl isRequired><FormLabel>Następne działanie</FormLabel><Input value={nextActionTitle} onChange={(event) => setNextActionTitle(event.target.value)} /></FormControl><FormControl isRequired><FormLabel>Termin</FormLabel><Input type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></FormControl></> : null}
          </Flex></ModalBody>
          <ModalFooter gap="10px"><Button variant="outline" onClick={() => setMove(null)}>Anuluj</Button><Button colorScheme="purple" onClick={saveMove} isLoading={saving}>Zmień etap</Button></ModalFooter>
        </ModalContent>
      </Modal>
    </Flex>
  );
}
