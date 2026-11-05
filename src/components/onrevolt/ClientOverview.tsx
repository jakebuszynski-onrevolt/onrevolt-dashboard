'use client';

import React, { useState, type ReactNode } from 'react';
import { Avatar, Box, Tooltip, useColorModeValue } from '@chakra-ui/react';
import { FiArrowUpRight, FiCalendar, FiChevronLeft, FiChevronRight, FiEdit2, FiMail, FiMapPin, FiPhone, FiPlus, FiTrash2, FiUser, FiX } from 'react-icons/fi';
import styles from './ClientOverview.module.css';

export type OverviewNote = {
  id: string; title: string; body?: string | null; occurredAt?: string | null;
  actor?: { name?: string | null; avatarUrl?: string | null } | null;
};
export type OverviewTask = {
  id: string; title: string; description?: string | null; status: string; priority: string;
  dueAt?: string | null; assignedTo?: { name?: string | null; avatarUrl?: string | null } | null;
};
export type ClientOverviewProps = {
  name: string; phone?: string; email?: string; investmentAddress?: string; correspondenceAddress?: string;
  registeredAt?: string | null; owner?: { name?: string | null; avatarUrl?: string | null } | null;
  notes: OverviewNote[]; tasks: OverviewTask[]; canWrite: boolean;
  noteDraft: { title: string; body: string };
  onNoteDraftChange: (draft: { title: string; body: string }) => void;
  onOpenClient: () => void; onOpenTasks: () => void;
  onAddNote: (input: { title: string; body: string }) => Promise<void>;
  onEditNote: (note: OverviewNote, input: { title: string; body: string }) => Promise<void>;
  onDeleteNote: (note: OverviewNote) => Promise<void>;
};

const dateFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw' });
const timeFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
function date(value?: string | null, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return (withTime ? timeFormat : dateFormat).format(new Date(value));
}
export function overviewTaskStats(tasks: OverviewTask[], now: number) {
  return {
    all: tasks.length,
    todo: tasks.filter(task => task.status === 'OPEN').length,
    progress: tasks.filter(task => task.status === 'IN_PROGRESS').length,
    overdue: tasks.filter(task => task.status !== 'DONE' && task.status !== 'CANCELLED'
      && task.dueAt && Date.parse(task.dueAt) < now).length,
  };
}

function Tool({ label, children, onClick, disabled, primary = false }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean;
}) {
  return <Tooltip label={label}><button type="button" aria-label={label} title={label}
    disabled={disabled} onClick={onClick} className={`${styles.tool} ${primary ? styles.primaryTool : ''}`}>{children}</button></Tooltip>;
}

function Pager({ name, index, count, onChange, disabled }: {
  name: string; index: number; count: number; onChange: (index: number) => void; disabled?: boolean;
}) {
  return <footer className={styles.pager}>
    <span aria-live="polite">{name} {count ? index + 1 : 0}/{count}</span>
    <Tool label={`Poprzednie: ${name}`} disabled={disabled || index === 0 || !count} onClick={() => onChange(index - 1)}><FiChevronLeft /></Tool>
    <Tool label={`Następne: ${name}`} primary disabled={disabled || index >= count - 1} onClick={() => onChange(index + 1)}><FiChevronRight /></Tool>
  </footer>;
}

function Person({ name, avatarUrl }: { name?: string | null; avatarUrl?: string | null }) {
  return <span className={styles.person}><Avatar size="xs" name={name || undefined} src={avatarUrl || undefined} /><strong>{name || 'Nieprzypisany'}</strong></span>;
}

export default function ClientOverview(props: ClientOverviewProps) {
  const [noteIndex, setNoteIndex] = useState(0);
  const [taskIndex, setTaskIndex] = useState(0);
  const [adding, setAdding] = useState(!!(props.noteDraft.title || props.noteDraft.body));
  const { title, body } = props.noteDraft;
  const setTitle = (title: string) => props.onNoteDraftChange({ title, body });
  const setBody = (body: string) => props.onNoteDraftChange({ title, body });
  const [deleting, setDeleting] = useState<OverviewNote | null>(null);
  const [editing, setEditing] = useState<OverviewNote | null>(null);
  const [editDraft, setEditDraft] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ni = Math.min(noteIndex, Math.max(0, props.notes.length - 1));
  const ti = Math.min(taskIndex, Math.max(0, props.tasks.length - 1));
  const note = props.notes[ni];
  const task = props.tasks[ti];
  const now = Date.now();
  const stats = overviewTaskStats(props.tasks, now);
  const overdue = task && task.status !== 'DONE' && task.status !== 'CANCELLED' && task.dueAt && Date.parse(task.dueAt) < now;
  const overdueDays = overdue && task?.dueAt ? Math.max(1, Math.ceil((now - Date.parse(task.dueAt)) / 86_400_000)) : 0;
  const colors = {
    '--overview-bg': useColorModeValue('#ffffff', '#111c44'),
    '--overview-text': useColorModeValue('#1b2559', '#ffffff'),
    '--overview-muted': useColorModeValue('#a3aed0', '#a3aed0'),
    '--overview-line': useColorModeValue('#e9edf7', '#2b365d'),
    '--overview-soft': useColorModeValue('#f4f7fe', '#1b2857'),
  };
  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true); setError('');
    try {
      await props.onAddNote({ title: title.trim() || 'Notatka', body: body.trim() });
      props.onNoteDraftChange({ title: '', body: '' }); setAdding(false); setNoteIndex(0);
    } catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać notatki.'); }
    finally { setBusy(false); }
  }
  async function deleteNote() {
    if (!deleting || busy) return;
    setBusy(true); setError('');
    try { await props.onDeleteNote(deleting); setDeleting(null); }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się usunąć notatki.'); }
    finally { setBusy(false); }
  }
  async function editNote(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || busy || !editDraft.body.trim()) return;
    setBusy(true); setError('');
    try {
      await props.onEditNote(editing, { title: editDraft.title.trim() || 'Notatka', body: editDraft.body.trim() });
      setEditing(null);
    } catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać notatki.'); }
    finally { setBusy(false); }
  }
  const fields = [
    { label: 'Klient', value: props.name, icon: FiUser },
    { label: 'Telefon', value: props.phone, icon: FiPhone, href: props.phone ? `tel:${props.phone}` : undefined },
    { label: 'E-mail', value: props.email, icon: FiMail, href: props.email ? `mailto:${props.email}` : undefined },
    { label: 'Adres inwestycji', value: props.investmentAddress, icon: FiMapPin },
    { label: 'Adres korespondencyjny', value: props.correspondenceAddress, icon: FiMapPin },
    { label: 'Data rejestracji', value: date(props.registeredAt), icon: FiCalendar },
  ];
  return <Box className={styles.grid} style={colors as React.CSSProperties}>
    <section className={`${styles.module} ${styles.client}`} aria-label="Dane klienta">
      <header className={styles.header}><h2>Dane klienta</h2><Tool label="Edytuj dane klienta" onClick={props.onOpenClient}><FiArrowUpRight /></Tool></header>
      <div className={styles.fields}>{fields.map(field => <div className={styles.field} key={field.label}>
        <span className={styles.fieldIcon}><field.icon /></span><div><span>{field.label}</span>
          {field.href ? <a href={field.href}>{field.value}</a> : <strong>{field.value || '—'}</strong>}</div>
      </div>)}
        <div className={styles.field}><Avatar size="sm" name={props.owner?.name || undefined} src={props.owner?.avatarUrl || undefined} />
          <div><span>Opiekun</span><strong>{props.owner?.name || 'Nieprzypisany'}</strong></div></div>
      </div>
    </section>
    <section className={styles.module} aria-label="Notatki">
      <header className={styles.header}><div><h2>Notatki</h2><p>Razem: {props.notes.length}</p></div>
        {props.canWrite && <Tool label={adding ? 'Zamknij dodawanie notatki' : 'Dodaj notatkę'} disabled={busy || !!editing} onClick={() => { setAdding(!adding); setDeleting(null); setError(''); }}>{adding ? <FiX /> : <FiPlus />}</Tool>}
      </header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {editing && props.canWrite ? <form className={styles.noteForm} onSubmit={editNote} aria-label="Edytuj notatkę">
        {editing.id !== 'legacy-client-note' && <label>Tytuł <span>(opcjonalnie)</span><input autoFocus maxLength={200} value={editDraft.title} disabled={busy} onChange={event => setEditDraft(current => ({ ...current, title: event.target.value }))} /></label>}
        <label>Treść notatki<textarea autoFocus={editing.id === 'legacy-client-note'} required rows={5} value={editDraft.body} disabled={busy} onChange={event => setEditDraft(current => ({ ...current, body: event.target.value }))} /></label>
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Anuluj</button><button className={styles.save} disabled={busy || !editDraft.body.trim()}>{busy ? 'Zapisywanie…' : 'Zapisz zmiany'}</button></div>
      </form> : adding && props.canWrite ? <form className={styles.noteForm} onSubmit={addNote}>
        <label>Tytuł <span>(opcjonalnie)</span><input autoFocus maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
        <label>Treść notatki<textarea required rows={5} value={body} disabled={busy} onChange={event => setBody(event.target.value)} /></label>
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { props.onNoteDraftChange({ title: '', body: '' }); setAdding(false); setError(''); }}>Anuluj</button><button className={styles.save} disabled={busy || !body.trim()}>{busy ? 'Zapisywanie…' : 'Dodaj notatkę'}</button></div>
      </form> : note ? <article className={styles.entry}>
        <div className={styles.entryHeading}><h3>{note.title}</h3>{props.canWrite && <div className={styles.noteTools}><Tool label="Edytuj notatkę" disabled={busy || !!deleting} onClick={() => { setEditing(note); setEditDraft({ title: note.title, body: note.body || '' }); setError(''); }}><FiEdit2 /></Tool><Tool label="Usuń notatkę" disabled={busy} onClick={() => { setDeleting(note); setError(''); }}><FiTrash2 /></Tool></div>}</div>
        <div className={styles.body}>{note.body || '—'}</div>
        <div className={styles.meta}><Person name={note.actor?.name || 'Notatka ogólna'} avatarUrl={note.actor?.avatarUrl} /><time>{date(note.occurredAt, true)}</time></div>
      </article> : <p className={styles.empty}>Brak notatek.</p>}
      {deleting && props.canWrite && <div role="alertdialog" aria-label="Potwierdź usunięcie notatki" className={styles.confirm}>
        <p>Usunąć notatkę „{deleting.title}”? Tej operacji nie można cofnąć.</p>
        <div className={styles.actions}><button autoFocus type="button" disabled={busy} onClick={() => { setDeleting(null); setError(''); }}>Anuluj</button><button type="button" className={styles.danger} disabled={busy} onClick={deleteNote}>{busy ? 'Usuwanie…' : 'Usuń notatkę'}</button></div>
      </div>}
      {!adding && <Pager name="Notatki" index={ni} count={props.notes.length} disabled={busy || !!deleting || !!editing} onChange={setNoteIndex} />}
    </section>
    <section className={styles.module} aria-label="Zadania">
      <header className={styles.header}><h2>Zadania</h2><Tool label="Otwórz zadania klienta" onClick={props.onOpenTasks}><FiArrowUpRight /></Tool></header>
      <div className={styles.stats}>{[['Wszystkie',stats.all],['Do zrobienia',stats.todo],['W trakcie',stats.progress],['Zaległe',stats.overdue]].map(([label, value], index) => <div key={label} className={styles[`stat${index}`]}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {task ? <article className={styles.entry}>
        <div className={styles.entryHeading}><h3>{task.title}</h3><div className={styles.badges}><span className={task.status === 'DONE' ? styles.done : styles.status}>{({ OPEN: 'Do zrobienia', IN_PROGRESS: 'W trakcie', DONE: 'Zakończone', CANCELLED: 'Anulowane' } as Record<string,string>)[task.status] || task.status}</span><span className={task.priority === 'HIGH' || task.priority === 'URGENT' ? styles.high : styles.status}>{({ LOW:'Niski', NORMAL:'Normalny', MEDIUM:'Normalny', HIGH:'Wysoki', URGENT:'Pilny' } as Record<string,string>)[task.priority] || task.priority}</span></div></div>
        <div className={styles.body}>{task.description || 'Brak opisu.'}</div>
        <div className={styles.meta}><Person name={task.assignedTo?.name} avatarUrl={task.assignedTo?.avatarUrl} /><div className={styles.deadline}>{overdue && <span>Zaległe o {overdueDays} {overdueDays === 1 ? 'dzień' : 'dni'}</span>}<time>{date(task.dueAt, true)}</time></div></div>
      </article> : <p className={styles.empty}>Brak zadań.</p>}
      <Pager name="Zadania" index={ti} count={props.tasks.length} onChange={setTaskIndex} />
    </section>
  </Box>;
}
