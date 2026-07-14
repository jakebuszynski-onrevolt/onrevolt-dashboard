'use client';

import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Icon, Input, Progress, Select, SimpleGrid, Spinner, Text, useColorModeValue } from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MdLocalShipping, MdOutlineInventory2, MdRefresh } from 'react-icons/md';

const labels: Record<string, string> = { DRAFT: 'Robocze', ORDERED: 'Zamówione', PARTIAL: 'Dostawa częściowa', DELIVERED: 'Dostarczone', CANCELLED: 'Anulowane' };
const colors: Record<string, string> = { DRAFT: 'gray', ORDERED: 'blue', PARTIAL: 'orange', DELIVERED: 'green', CANCELLED: 'red' };

async function payload(response: Response) {
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body.data;
}

export default function OrdersWorkspace() {
  const [orders, setOrders] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [offerId, setOfferId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const muted = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const border = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await payload(await fetch('/api/orders', { cache: 'no-store' })); setOrders(data.orders || []); setOffers(data.offers || []); setSelectedId((id) => data.orders.some((x: any) => x.id === id) ? id : data.orders[0]?.id || ''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const selected = orders.find((order) => order.id === selectedId) || orders[0];
  const stats = useMemo(() => ({ active: orders.filter((o) => !['DELIVERED', 'CANCELLED'].includes(o.status)).length, delayed: orders.filter((o) => o.expectedAt && new Date(o.expectedAt) < new Date() && o.status !== 'DELIVERED').length, delivered: orders.filter((o) => o.status === 'DELIVERED').length, reserved: orders.flatMap((o) => o.items).flatMap((i: any) => i.reservations).filter((r: any) => r.status === 'RESERVED').length }), [orders]);

  async function createOrders() {
    setSaving(true); setError(''); setNotice('');
    try { const created = await payload(await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerId, expectedAt }) })); setOrders((current) => [...created, ...current]); setSelectedId(created[0]?.id || ''); setNotice(`Utworzono ${created.length} zamówienie/zamówienia według dostawców.`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  async function updateStatus(id: string, status: string) {
    setSaving(true); setError('');
    try { const order = await payload(await fetch('/api/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })); setOrders((current) => current.map((item) => item.id === id ? order : item)); setNotice(`Zaktualizowano ${order.number}.`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  if (loading) return <Flex pt="100px" justify="center"><Spinner /></Flex>;
  return <Flex direction="column" pt={{ base: '130px', md: '80px' }} gap="20px">
    <Card p="24px"><Flex justify="space-between" gap="16px" wrap="wrap"><Box><Text color={muted} fontWeight="700">Realizacja</Text><Text color={textColor} fontSize="3xl" fontWeight="900">Zamówienia i rezerwacje</Text><Text color={muted}>Od zaakceptowanej oferty przez dostawę do wydania ekipie.</Text></Box><Button leftIcon={<Icon as={MdRefresh} />} onClick={load}>Odśwież</Button></Flex></Card>
    {error ? <Alert status="error"><AlertIcon />{error}</Alert> : null}{notice ? <Alert status="success"><AlertIcon />{notice}</Alert> : null}
    <SimpleGrid columns={{ base: 2, xl: 4 }} gap="12px">{[['Aktywne', stats.active], ['Po terminie', stats.delayed], ['Dostarczone', stats.delivered], ['Rezerwacje', stats.reserved]].map(([name, value]) => <Card key={String(name)} p="18px"><Text color={muted}>{name}</Text><Text color={textColor} fontSize="2xl" fontWeight="900">{value}</Text></Card>)}</SimpleGrid>
    <Card p="22px"><Text color={textColor} fontWeight="900" fontSize="lg" mb="14px">Utwórz z zaakceptowanej oferty</Text><SimpleGrid columns={{ base: 1, lg: 3 }} gap="12px" alignItems="end"><FormControl><FormLabel>Oferta</FormLabel><Select value={offerId} onChange={(e) => setOfferId(e.target.value)}><option value="">Wybierz ofertę</option>{offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.number} - {offer.project.client.displayName}{offer.purchaseOrders.length ? ' (ma zamówienie)' : ''}</option>)}</Select></FormControl><FormControl><FormLabel>Oczekiwana dostawa</FormLabel><Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></FormControl><Button colorScheme="purple" leftIcon={<Icon as={MdOutlineInventory2} />} onClick={createOrders} isLoading={saving} isDisabled={!offerId}>Utwórz zapotrzebowanie</Button></SimpleGrid></Card>
    <SimpleGrid columns={{ base: 1, '2xl': 2 }} gap="20px"><Card p="20px"><Text color={textColor} fontWeight="900" mb="12px">Zamówienia</Text><Flex direction="column" gap="8px">{orders.length ? orders.map((order) => <Box key={order.id} as="button" textAlign="left" p="12px" border="1px solid" borderColor={selected?.id === order.id ? 'purple.300' : border} borderRadius="8px" onClick={() => setSelectedId(order.id)}><Flex justify="space-between"><Box><Text color={textColor} fontWeight="900">{order.number}</Text><Text color={muted} fontSize="sm">{order.project.client.displayName} · {order.supplier}</Text></Box><Badge colorScheme={colors[order.status]}>{labels[order.status]}</Badge></Flex></Box>) : <Text color={muted}>Brak zamówień.</Text>}</Flex></Card>
    <Card p="20px">{selected ? <><Flex justify="space-between" align="start" gap="10px"><Box><Text color={textColor} fontWeight="900" fontSize="lg">{selected.number}</Text><Text color={muted}>{selected.supplier}</Text></Box><Select maxW="190px" value={selected.status} onChange={(e) => updateStatus(selected.id, e.target.value)} isDisabled={saving}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Flex><Flex direction="column" gap="12px" mt="18px">{selected.items.map((item: any) => { const received = Number(item.receivedQuantity); const total = Number(item.quantity); return <Box key={item.id} borderTop="1px solid" borderColor={border} pt="10px"><Flex justify="space-between" gap="10px"><Box><Text color={textColor} fontWeight="800">{item.name}</Text><Text color={muted} fontSize="sm">{item.supplierSku || 'Bez SKU'} · rezerwacja {item.reservations[0]?.status || '-'}</Text></Box><Text color={textColor}>{received}/{total}</Text></Flex><Progress mt="6px" value={total ? received / total * 100 : 0} colorScheme="green" borderRadius="4px" /></Box>})}</Flex>{selected.status !== 'DELIVERED' && selected.status !== 'CANCELLED' ? <Button mt="18px" colorScheme="green" leftIcon={<Icon as={MdLocalShipping} />} onClick={() => updateStatus(selected.id, 'DELIVERED')} isLoading={saving}>Oznacz całość jako dostarczoną</Button> : null}</> : <Text color={muted}>Wybierz zamówienie.</Text>}</Card></SimpleGrid>
  </Flex>;
}
