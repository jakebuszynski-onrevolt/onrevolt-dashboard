'use client';

import { Alert, AlertIcon, Badge, Box, Button, Flex, Icon, SimpleGrid, Spinner, Text, useColorModeValue } from '@chakra-ui/react';
import Card from 'components/card/Card';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MdAssignment, MdConstruction, MdOpenInNew, MdRefresh, MdWarningAmber } from 'react-icons/md';

function dateTime(value?: string | null) {
  if (!value) return 'Bez terminu';
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function DashboardWorkspace() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setData(payload.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  const stats = data?.stats || {};

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px' }} gap="20px">
      <Flex justify="space-between" align="center" gap="12px">
        <Box>
          <Text color={textColor} fontSize="2xl" fontWeight="800">Dashboard</Text>
          <Text color={mutedColor}>Praca zespołu na dziś</Text>
        </Box>
        <Button leftIcon={<MdRefresh />} variant="outline" onClick={load} isLoading={loading}>Odśwież</Button>
      </Flex>
      {error ? <Alert status="error" borderRadius="8px"><AlertIcon />{error}</Alert> : null}
      {loading && !data ? <Flex justify="center" py="80px"><Spinner /></Flex> : (
        <>
          <SimpleGrid columns={{ base: 2, xl: 4 }} gap="16px">
            {[
              ['Aktywne projekty', stats.activeProjects || 0, 'purple'],
              ['Zadania otwarte', stats.openTasks || 0, 'blue'],
              ['Na dziś', stats.todayTasks || 0, 'green'],
              ['Zaległe', stats.overdueTasks || 0, 'red'],
            ].map(([label, value, tone]) => (
              <Card key={String(label)} p="18px"><Text color={mutedColor} fontSize="sm">{label}</Text><Text color={textColor} fontSize="2xl" fontWeight="800">{value}</Text><Badge colorScheme={String(tone)} mt="8px">{label}</Badge></Card>
            ))}
          </SimpleGrid>
          <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
            <Card p="20px">
              <Flex align="center" gap="8px" mb="14px"><Icon as={MdAssignment} /><Text color={textColor} fontWeight="800">Zadania na dziś</Text></Flex>
              <Flex direction="column" gap="10px">
                {(data?.today || []).map((task: any) => <TaskRow key={task.id} task={task} textColor={textColor} mutedColor={mutedColor} borderColor={borderColor} />)}
                {!data?.today?.length ? <Text color={mutedColor}>Brak zadań na dziś.</Text> : null}
              </Flex>
            </Card>
            <Card p="20px">
              <Flex align="center" gap="8px" mb="14px"><Icon as={MdWarningAmber} color="red.400" /><Text color={textColor} fontWeight="800">Zaległe</Text></Flex>
              <Flex direction="column" gap="10px">
                {(data?.overdue || []).map((task: any) => <TaskRow key={task.id} task={task} textColor={textColor} mutedColor={mutedColor} borderColor={borderColor} />)}
                {!data?.overdue?.length ? <Text color={mutedColor}>Brak zaległych zadań.</Text> : null}
              </Flex>
            </Card>
          </SimpleGrid>
          <SimpleGrid columns={{ base: 1, xl: 3 }} gap="20px">
            <Card p="20px" gridColumn={{ xl: 'span 2' }}>
              <Text color={textColor} fontWeight="800" mb="14px">Lejek projektów</Text>
              <SimpleGrid columns={{ base: 2, md: 4 }} gap="10px">
                {(data?.stages || []).map((stage: any) => <Box key={stage.id} border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px"><Text color={mutedColor} fontSize="xs">{stage.name}</Text><Text color={textColor} fontWeight="800" fontSize="xl">{stage.count}</Text></Box>)}
              </SimpleGrid>
            </Card>
            <Card p="20px">
              <Text color={textColor} fontWeight="800" mb="14px">Do uzupełnienia</Text>
              <Flex direction="column" gap="10px">
                <QualityRow label="Bez właściciela" value={data?.dataQuality?.withoutOwner || 0} />
                <QualityRow label="Bez następnego działania" value={data?.dataQuality?.withoutNextAction || 0} />
                <QualityRow label="Typ klienta nieokreślony" value={data?.dataQuality?.unknownClientType || 0} />
              </Flex>
            </Card>
          </SimpleGrid>
          <Card p="20px">
            <Flex align="center" gap="8px" mb="14px"><Icon as={MdConstruction} /><Text color={textColor} fontWeight="800">Najbliższe montaże</Text></Flex>
            <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="12px">
              {(data?.installations || []).map((item: any) => <Box key={item.id} border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px"><Text color={textColor} fontWeight="700">{item.project.client.displayName}</Text><Text color={mutedColor} fontSize="sm">{dateTime(item.plannedAt)}</Text><Badge mt="8px">{item.status}</Badge></Box>)}
              {!data?.installations?.length ? <Text color={mutedColor}>Brak zaplanowanych montaży.</Text> : null}
            </SimpleGrid>
          </Card>
        </>
      )}
    </Flex>
  );
}

function TaskRow({ task, textColor, mutedColor, borderColor }: any) {
  return <Flex border="1px solid" borderColor={borderColor} borderRadius="8px" p="10px" align="center" gap="10px"><Box flex="1"><Text color={textColor} fontWeight="700">{task.title}</Text><Text color={mutedColor} fontSize="sm">{task.client?.displayName || task.project?.title || 'Bez klienta'} · {dateTime(task.dueAt)}</Text></Box><Button as={Link} href={`/admin/tasks?taskId=${task.id}`} size="sm" variant="ghost" aria-label="Otwórz zadanie"><Icon as={MdOpenInNew} /></Button></Flex>;
}

function QualityRow({ label, value }: { label: string; value: number }) {
  return <Flex justify="space-between" align="center"><Text fontSize="sm">{label}</Text><Badge colorScheme={value ? 'orange' : 'green'}>{value}</Badge></Flex>;
}
