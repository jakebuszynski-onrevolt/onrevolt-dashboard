(function (root, factory) {
  const create = factory();
  if (typeof module === 'object' && module.exports) module.exports = create;
  else root.ClientTariffPreview = create(root);
})(typeof window === 'undefined' ? globalThis : window, function () {
  return function createClientTariffPreview(root) {
    let canonical = null;
    let selection = 'real';
    let station = null;
    let controls = null;
    const hasHistory = () => Boolean(canonical?.tariffHistory?.strict);
    const active = () => Boolean(canonical?.tariffData || hasHistory());
    const operators = () => canonical?.tariffData?.catalog?.operators || [];
    const actual = () => canonical?.tariffData?.current || null;
    const baseline = () => hasHistory() ? actual() : canonical?.tariffData?.next || null;
    function candidates() {
      return operators().flatMap(osd => (osd.tariffs || []).filter(t => t.detail).map(t => ({
        key: `catalog:${osd.id}:${t.id}`, operator: osd.name, tariff: t.detail,
      })));
    }
    function selected() {
      if (selection === 'real') return baseline();
      return candidates().find(row => row.key === selection)?.tariff || null;
    }
    function project(input, incremental) {
      if (!input || typeof input !== 'object') return input;
      const nextStation = input.account?.station ?? input.energy?.station ?? station;
      if (station !== null && nextStation !== station) { canonical = null; selection = 'real'; }
      station = nextStation;
      // Incremental readings may omit context. Keep only the original tariff/account settings.
      canonical = incremental && canonical ? Object.assign({}, canonical, input) : input;
      if (!active()) { selection = 'real'; return input; }
      // A station without CRM history keeps its saved simulation until the user tests another tariff.
      if (!hasHistory() && selection === 'real') return canonical;
      const tariff = selected();
      if (!tariff && selection !== 'real') throw new Error('Wybrana taryfa testowa nie jest już dostępna. Wróć do rzeczywistej.');
      if (!tariff) return Object.assign({}, canonical, {
        clientTariffPreview: false,
        tariffData: Object.assign({}, canonical.tariffData, { next: null }),
      });
      const account = canonical.account || {};
      const operator = operators().find(row => Number(row.id) === Number(tariff.osd_id))?.name || tariff.osd_name || tariff.provider;
      const target = Object.assign({}, account.tariffSettings?.[selection === 'real' ? 'current' : 'target'] || {}, {
        osdId: tariff.osd_id, tariffId: tariff.tariff_id, code: tariff.code, name: tariff.name,
        operator, provider: operator, osdName: operator,
      });
      return Object.assign({}, canonical, {
        clientTariffPreview: selection !== 'real',
        tariffData: Object.assign({}, canonical.tariffData, { next: tariff }),
        account: Object.assign({}, account, {
          tariffTargetOsdId: tariff.osd_id, tariffTargetTariffId: tariff.tariff_id,
          tariffSettings: Object.assign({}, account.tariffSettings, { target }),
        }),
      });
    }
    function projectReResponse(response) {
      if (!active() || !response?.ok || !response.data?.tariff_id) return response;
      const tariff = selected();
      if (!tariff || Number(tariff.tariff_id) !== Number(response.data.tariff_id) || Number(tariff.osd_id) !== Number(response.data.osd_id)) return response;
      return Object.assign({}, response, { data: tariff });
    }
    function cacheKey() {
      return active() ? JSON.stringify([selection, canonical.tariffHistory?.cacheKey, selected()]) : '';
    }
    function savedTariffFields() {
      if (!hasHistory()) return {};
      const account = canonical.account || {}, settings = account.tariffSettings || {};
      return {
        currentOperatorId: settings.current?.osdId ?? account.tariffCurrentOsdId ?? '',
        currentTariffId: settings.current?.tariffId ?? account.tariffCurrentTariffId ?? '',
        targetOperatorId: settings.target?.osdId ?? account.tariffTargetOsdId ?? '',
        targetTariffId: settings.target?.tariffId ?? account.tariffTargetTariffId ?? '',
      };
    }
    function choose(key) {
      if (!active()) throw new Error('Brak danych taryf stacji.');
      if (key !== 'real' && !candidates().some(row => row.key === key)) throw new Error('Brak kompletnych danych taryfy testowej.');
      selection = key;
      if (typeof root.updateDashboardPayload === 'function') root.updateDashboardPayload(canonical);
      sync();
    }
    function sync() {
      const doc = root.document;
      if (!doc) return;
      const section = doc.querySelector('[aria-labelledby="setup-tariffs-title"]');
      if (!section) return;
      const grid = section.querySelector('.setup-grid--tariffs');
      if (!controls) {
        const box = doc.createElement('div');
        box.className = 'client-tariff-preview';
        box.innerHTML = '<label class="setup-field"><span>Podgląd taryfy</span><select id="client-tariff-preview-select"></select></label><div class="client-tariff-preview-actions"><span id="client-tariff-preview-mode" role="status"></span><button type="button" class="setup-button setup-button--secondary" id="client-tariff-preview-reset">Wróć do rzeczywistej</button></div><p class="client-tariff-preview-summary"></p>';
        section.appendChild(box);
        const saved = doc.createElement('details'), summary = doc.createElement('summary');
        saved.className = 'client-tariff-preview-saved';
        summary.textContent = 'Zapisane taryfy RE';
        saved.appendChild(summary);
        if (grid) saved.appendChild(grid);
        section.appendChild(saved);
        const banner = doc.createElement('div');
        banner.className = 'client-tariff-preview-banner';
        banner.setAttribute('role', 'status');
        const caption = doc.createElement('span'), reset = doc.createElement('button');
        reset.type = 'button'; reset.textContent = 'Wróć do rzeczywistej';
        banner.append(caption, reset); doc.body.prepend(banner);
        controls = { box, saved, summary: box.querySelector('.client-tariff-preview-summary'), select: box.querySelector('select'), mode: box.querySelector('[role="status"]'), reset: box.querySelector('button'), banner, caption, bannerReset: reset };
        controls.select.addEventListener('change', () => choose(controls.select.value));
        controls.reset.addEventListener('click', () => choose('real'));
        reset.addEventListener('click', () => choose('real'));
      }
      const enabled = active(), testing = enabled && selection !== 'real';
      controls.box.hidden = !enabled; controls.banner.hidden = !testing;
      controls.saved.hidden = hasHistory();
      if (grid) grid.hidden = hasHistory();
      if (!enabled) return;
      const real = baseline(), prefix = hasHistory() ? 'Rzeczywista (CRM)' : 'Zapisana symulacja (RE)';
      controls.select.replaceChildren();
      const option = doc.createElement('option'); option.value = 'real';
      option.textContent = `${prefix} · ${real?.code || 'Wymaga uzupełnienia'}`;
      controls.select.appendChild(option);
      for (const row of candidates()) {
        const item = doc.createElement('option'); item.value = row.key;
        item.textContent = `Test · ${row.operator} · ${row.tariff.code}`;
        controls.select.appendChild(item);
      }
      controls.select.value = selection;
      controls.reset.disabled = !testing;
      controls.reset.textContent = controls.bannerReset.textContent = hasHistory() ? 'Wróć do rzeczywistej' : 'Wróć do zapisanej';
      controls.mode.textContent = testing ? 'Tryb testowy · Bez zapisu taryfy' : hasHistory() ? 'Taryfa rzeczywista · Ceny i strefy z CRM' : 'Zapisana symulacja RE';
      controls.summary.hidden = hasHistory();
      controls.summary.textContent = `Dotychczasowa (RE): ${actual()?.code || 'Nie wybrano'}. Brak indywidualnej historii taryf CRM.`;
      controls.caption.textContent = testing ? `Podgląd testowy · ${selected()?.code || 'Brak danych'}` : '';
    }
    if (root.document) root.document.addEventListener('dashboard:payload-updated', sync);
    return { project, choose, savedTariffFields, projectReResponse, cacheKey, setupPayload: input => canonical || input, isTesting: () => active() && selection !== 'real', sync };
  };
});
