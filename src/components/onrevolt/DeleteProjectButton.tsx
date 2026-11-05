'use client';

import { useRef, useState } from 'react';
import { Alert, AlertIcon, AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader,
  AlertDialogBody, AlertDialogFooter, Button, IconButton, Text, Tooltip } from '@chakra-ui/react';
import { MdDeleteOutline } from 'react-icons/md';

export default function DeleteProjectButton({ project, clientId, disabled, onBusyChange, onDeleted }: {
  project: { id: string; title: string; updatedAt: string };
  clientId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, expectedTitle: project.title, expectedUpdatedAt: project.updatedAt, confirm: true }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      setOpen(false);
      await onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się usunąć projektu.');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return <>
    <Tooltip label="Usuń wybrany projekt">
      <IconButton aria-label="Usuń wybrany projekt" icon={<MdDeleteOutline />} size="sm" variant="outline"
        colorScheme="red" isDisabled={disabled || busy} onClick={() => { setError(''); setOpen(true); }} />
    </Tooltip>
    <AlertDialog isOpen={open} leastDestructiveRef={cancelRef} onClose={() => { if (!busy) setOpen(false); }} closeOnOverlayClick={!busy} closeOnEsc={!busy}>
      <AlertDialogOverlay><AlertDialogContent>
        <AlertDialogHeader>Usunąć projekt?</AlertDialogHeader>
        <AlertDialogBody>
          <Text fontWeight="700" mb="12px">{project.title}</Text>
          <Text>Usunięcie jest trwałe. Puste formularze danych energetycznych i puste konta operatora zostaną usunięte razem z projektem. Pomiary, dokumenty i inne zapisane dane blokują usunięcie.</Text>
          <Text mt="8px">Konto operatora z pomiarami należącymi wyłącznie do innego projektu tego klienta pozostanie przy tamtym projekcie. Klient i pozostałe projekty nie zostaną usunięte.</Text>
          <Text mt="8px">Niezapisane zmiany tego projektu zostaną odrzucone.</Text>
          {error ? <Alert status="error" mt="12px"><AlertIcon />{error}</Alert> : null}
        </AlertDialogBody>
        <AlertDialogFooter gap="8px">
          <Button ref={cancelRef} isDisabled={busy} onClick={() => setOpen(false)}>Anuluj</Button>
          <Button colorScheme="red" isLoading={busy} onClick={remove}>Usuń projekt</Button>
        </AlertDialogFooter>
      </AlertDialogContent></AlertDialogOverlay>
    </AlertDialog>
  </>;
}
