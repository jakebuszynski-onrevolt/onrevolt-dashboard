export type AuditDraft = {
  key: string;
  record: Record<string, any>;
  dirty: boolean;
  revision: number;
  pending?: { body: Record<string, any>; revision: number };
  blocked?: string;
};

type DraftStore = { version: 1; selected: string; drafts: AuditDraft[] };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export class SiteAuditDrafts {
  drafts: AuditDraft[] = [];
  selected = '';
  loaded = false;
  saving = false;
  error = '';
  storageError = '';
  private active?: Promise<any>;
  private readEpoch = 0;
  private closed = false;
  private listeners = new Set<() => void>();

  constructor(
    readonly storageKey: string,
    readonly projectId: string,
    private storage: Storage,
    private request: typeof fetch,
    private uuid: () => string,
    private ownerId: string,
  ) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get current() { return this.drafts.find((draft) => draft.key === this.selected); }

  private emit(persist = true) {
    if (persist) {
      try {
        const value: DraftStore = { version: 1, selected: this.selected, drafts: this.drafts };
        this.storage.setItem(this.storageKey, JSON.stringify(value));
        this.storageError = '';
      } catch {
        this.storageError = 'Nie można zachować szkicu na tym urządzeniu. Nie zamykaj formularza przed zapisem na serwerze.';
      }
    }
    this.listeners.forEach((listener) => listener());
  }

  restore() {
    if (this.closed) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const value = JSON.parse(raw) as DraftStore;
      if (value.version !== 1 || !Array.isArray(value.drafts)
        || value.drafts.some((draft) => !draft.key || draft.record?.projectId !== this.projectId)) {
        throw new Error('Invalid draft');
      }
      this.drafts = value.drafts;
      this.selected = value.selected;
      this.loaded = this.drafts.length > 0;
      this.emit(false);
    } catch {
      this.storageError = 'Nie udało się odczytać lokalnego szkicu. Nie czyść danych przeglądarki; skontaktuj się z administratorem.';
      this.emit(false);
      throw new Error(this.storageError);
    }
  }

  create(formData: Record<string, any>) {
    if (this.closed) return;
    const key = this.uuid();
    this.drafts.unshift({ key, revision: 0, dirty: false, record: {
      projectId: this.projectId, formData, status: 'DRAFT', currentStep: 1, completedSteps: [],
    } });
    this.selected = key;
    this.loaded = true;
    this.emit();
  }

  select(key: string) {
    if (this.closed) return;
    if (this.drafts.some((draft) => draft.key === key)) {
      this.selected = key;
      this.error = '';
      this.emit();
    }
  }

  edit(patch: Record<string, any>) {
    if (this.closed) return;
    const draft = this.current;
    if (!draft) return;
    draft.record = { ...draft.record, ...patch };
    draft.revision += 1;
    draft.dirty = true;
    // A server conflict needs an explicit resolution, not another automatic retry.
    if (draft.blocked && !draft.blocked.startsWith('Konflikt:')) draft.blocked = undefined;
    this.emit();
  }

  async load(initial: Record<string, any>) {
    if (this.closed) return;
    const epoch = ++this.readEpoch;
    const atStart = new Map(this.drafts.map((draft) => [draft.key, { revision: draft.revision, updatedAt: draft.record.updatedAt, id: draft.record.id }]));
    try {
      const response = await this.request(`/api/site-audits?projectId=${encodeURIComponent(this.projectId)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const payload = await response.json();
      if (this.closed || epoch !== this.readEpoch) return;
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się pobrać wizji lokalnych.');
      const records: any[] = payload.data;
      const byId = new Map(records.map((record) => [record.id, record]));
      this.drafts = this.drafts.filter((draft) => {
        const previous = atStart.get(draft.key);
        return draft.dirty || draft.pending || !draft.record.id || byId.has(draft.record.id)
          || !previous || previous.revision !== draft.revision || previous.id !== draft.record.id || previous.updatedAt !== draft.record.updatedAt;
      });
      for (const record of records) {
        const draft = this.drafts.find((item) => item.record.id === record.id || `draft-${item.key}` === record.id);
        if (draft) {
          if (!draft.dirty && !draft.pending
            && !(Date.parse(draft.record.updatedAt) > Date.parse(record.updatedAt))) draft.record = record;
        } else {
          this.drafts.push({ key: record.id, record, dirty: false, revision: 0 });
        }
      }
      if (!this.current) this.selected = this.drafts[0]?.key || '';
      this.loaded = true;
      this.error = '';
      if (!this.drafts.length) this.create(initial);
      else this.emit();
    } catch (error) {
      if (this.closed || epoch !== this.readEpoch) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.emit(false);
    }
  }

  updateDocuments(id: string, documents: any[]) {
    if (this.closed) return;
    const draft = this.drafts.find((item) => item.record.id === id);
    if (draft) {
      draft.record = { ...draft.record, documents };
      this.emit();
    }
  }

  remove(key: string) {
    if (this.closed) return;
    this.drafts = this.drafts.filter((draft) => draft.key !== key);
    if (this.selected === key) this.selected = this.drafts[0]?.key || '';
    this.emit();
  }

  async discardLocal() {
    const draft = this.current;
    if (!draft || this.saving || this.closed) return;
    const epoch = ++this.readEpoch;
    const id = draft.record.id || `draft-${draft.key}`;
    const response = await this.request(`/api/site-audits?projectId=${encodeURIComponent(this.projectId)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (this.closed || epoch !== this.readEpoch) return;
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się pobrać audytu.');
    const record = payload.data.find((item: any) => item.id === id);
    if (!record) throw new Error('Audytu nie ma na serwerze. Lokalny szkic został zachowany.');
    draft.record = record;
    draft.dirty = false;
    draft.pending = undefined;
    draft.blocked = undefined;
    this.error = '';
    this.emit();
  }

  async flush(key = this.selected): Promise<any> {
    if (this.closed) throw new Error('Formularz został zamknięty. Szkic pozostaje na urządzeniu.');
    // Serialize manual saves, autosave and retries; never race two writes.
    if (this.active) {
      await this.active;
      return this.flush(key);
    }
    const draft = this.drafts.find((item) => item.key === key);
    if (!draft) throw new Error('Nie znaleziono lokalnego szkicu.');
    if (draft.blocked) throw new Error(draft.blocked);
    if (!draft.dirty && !draft.pending) return draft.record;
    this.active = this.send(draft);
    try { return await this.active; }
    finally { this.active = undefined; }
  }

  async waitForSave() { await this.active?.catch(() => {}); }
  close() { this.closed = true; this.readEpoch += 1; }
  resume() { this.closed = false; }

  private async send(draft: AuditDraft): Promise<any> {
    this.saving = true;
    if (!draft.pending) {
      const record = draft.record;
      draft.pending = { revision: draft.revision, body: {
        id: record.id,
        clientDraftId: record.id ? undefined : draft.key,
        mutationId: this.uuid(),
        draftOwnerId: this.ownerId,
        expectedUpdatedAt: record.updatedAt || null,
        projectId: this.projectId,
        title: record.title,
        status: record.status,
        visitDate: record.formData.visit_date,
        auditorId: record.formData.auditor_id || undefined,
        currentStep: record.currentStep,
        completedSteps: record.completedSteps,
        formData: record.formData,
      } };
    }
    // Keep the exact request until acknowledged, including across reloads.
    const pending = draft.pending;
    this.emit();
    try {
      const response = await this.request('/api/site-audits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.body), signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        const message = payload.error || 'Nie udało się zapisać wizji lokalnej.';
        if (response.status === 409 || response.status === 404) draft.blocked = `Konflikt: ${message}`;
        else if (response.status >= 400 && response.status < 500) {
          draft.blocked = message;
          draft.pending = undefined;
          if (response.status === 400 && pending.body.status === 'COMPLETED') {
            draft.record = { ...draft.record, status: 'DRAFT', completedSteps: draft.record.completedSteps.filter((step: number) => step !== 7) };
          }
        }
        throw new Error(message);
      }
      const saved = payload.data;
      if (draft.revision === pending.revision) {
        draft.record = saved;
        draft.dirty = false;
      } else {
        draft.record = { ...draft.record, id: saved.id, updatedAt: saved.updatedAt, title: saved.title };
      }
      draft.pending = undefined;
      this.error = '';
      return saved;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.saving = false;
      this.emit();
    }
  }
}
