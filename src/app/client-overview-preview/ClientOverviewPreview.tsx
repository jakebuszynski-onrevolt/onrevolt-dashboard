'use client';
import { useState } from 'react';
import { Box, Button, useColorMode } from '@chakra-ui/react';
import ClientOverview, { type OverviewNote, type OverviewTask } from 'components/onrevolt/ClientOverview';

const person = { name: 'Mariusz Śmietana', avatarUrl: '/img/avatars/avatar1.png' };
const initialNotes: OverviewNote[] = [
  { id:'note-1', title:'Treść notatki', body:'Klient chce porównać magazyn energii 16 kWh z wariantem rozbudowy instalacji PV. Następny kontakt po przygotowaniu analizy zużycia i kosztów.', actor:person, occurredAt:'2026-07-18T11:28:00Z' },
  { id:'note-2', title:'Ustalenia po rozmowie', body:'Dostarczono komplet dokumentów. Potwierdzono termin wizji lokalnej.', actor:person, occurredAt:'2026-07-17T11:28:00Z' },
];
const tasks: OverviewTask[] = [
  { id:'task-1', title:'Treść zadania', description:'Przygotować propozycję zestawu oraz analizę oszczędności na podstawie danych pomiarowych klienta.', status:'IN_PROGRESS', priority:'HIGH', dueAt:'2026-11-01T11:28:00Z', assignedTo:person },
  { id:'task-2', title:'Umówienie wizji lokalnej i potwierdzenie dostępu do rozdzielni elektrycznej w obiekcie klienta', description:'Długi opis '.repeat(80), status:'OPEN', priority:'NORMAL', dueAt:'2026-12-03T11:28:00Z', assignedTo:person },
];

export default function ClientOverviewPreview() {
  const [notes,setNotes] = useState(initialNotes);
  const [noteDraft,setNoteDraft] = useState({ title:'', body:'' });
  const [fail,setFail] = useState(false);
  const [canWrite,setCanWrite] = useState(true);
  const [message,setMessage] = useState('');
  const {toggleColorMode} = useColorMode();
  return <Box p="24px" minH="100vh" bg="var(--chakra-colors-chakra-body-bg)">
    <Box mb="20px" display="flex" gap="12px" flexWrap="wrap">
      <Button onClick={toggleColorMode}>Zmień motyw</Button>
      <Button onClick={()=>setFail(!fail)}>{fail ? 'Błąd zapisu włączony' : 'Test błędu zapisu'}</Button>
      <Button onClick={()=>setCanWrite(!canWrite)}>{canWrite ? 'Tryb edycji' : 'Tylko odczyt'}</Button>
      <span role="status">{message}</span>
    </Box>
    <ClientOverview name="Jan Kowalski" phone="+48 600 123 456" email="jan.kowalski@email.pl"
      noteDraft={noteDraft} onNoteDraftChange={setNoteDraft}
      investmentAddress="ul. Słoneczna 12, 50-001 Wrocław" correspondenceAddress="ul. Słoneczna 12, 50-001 Wrocław"
      registeredAt="2026-06-12T10:00:00Z" owner={person} notes={notes} tasks={tasks} canWrite={canWrite}
      onOpenClient={()=>setMessage('Dane klienta')} onOpenTasks={()=>setMessage('Zadania klienta')}
      onAddNote={async input=>{if(fail)throw new Error('Testowy błąd połączenia. Treść pozostała w formularzu.');setNotes(current=>[{id:`note-${Date.now()}`,...input,occurredAt:new Date().toISOString(),actor:person},...current]);}}
      onEditNote={async (note,input)=>{if(fail)throw new Error('Testowy błąd połączenia. Treść pozostała w formularzu.');setNotes(current=>current.map(item=>item.id===note.id?{...item,...input}:item));}}
      onDeleteNote={async note=>{if(fail)throw new Error('Testowy błąd usuwania.');setNotes(current=>current.filter(item=>item.id!==note.id));}}
    />
  </Box>;
}
