(function (root) {
  "use strict";
  const VERSION = "20260930-capacity-charge-2";
  let basis = "gross";
  let settlementVatRate = null;
  let rates = [];
  let stationConfigured = false;

  function legacy(tariff) {
    return tariff && tariff.pricingLegacyTariff || tariff;
  }

  function resolveBasis(tariff) {
    const segment = String(tariff && tariff.segment || "").trim().toLowerCase();
    if (!segment) throw new Error("Brak segmentu taryfy docelowej; nie można ustalić podstawy cen.");
    return segment === "household" ? "gross" : "net";
  }

  function number(value, name) {
    if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
      throw new Error("Brak poprawnej kwoty: " + name);
    }
    return Number(value);
  }

  function projectTariff(input, selectedBasis) {
    if (!input) return input;
    const tariff = legacy(input);
    const mode = selectedBasis || basis;
    // Preserve the exact legacy values for households and for control, including historical rounding.
    if (mode === "gross") return tariff;
    if (input.pricingDisplayVersion === VERSION && input.priceBasis === mode) return input;
    const canonical = tariff.pricing && tariff.pricing.tariffStorage;
    if (!canonical || canonical.priceBasis !== "net") {
      throw new Error("Brak stawek netto taryfy " + (tariff.code || tariff.tariff_id));
    }
    const result = Object.assign({}, tariff, {
      priceBasis: "net", pricingDisplayVersion: VERSION, pricingLegacyTariff: tariff
    });
    [ ["fixed", "amount"], ["variable", "price"] ].forEach(function (spec) {
      const group = spec[0], field = spec[1];
      const rows = canonical[group] || [];
      if (rows.length !== (tariff[group] || []).length) throw new Error("Niespójna liczba składników taryfy " + tariff.code);
      result[group] = (tariff[group] || []).map(function (row, index) {
        // The legacy API omits row IDs; both projections use the same SQL ordering.
        const netRow = rows[index];
        if (!netRow || netRow.label !== row.label || (group === "variable" && netRow.window_code !== row.window_code)) {
          throw new Error("Niespójny składnik netto: " + row.label);
        }
        return Object.assign({}, row, {
          [field]: number(netRow.net, row.label),
          vatRate: number(netRow.vatRate, "VAT " + row.label), priceBasis: "net"
        });
      });
    });
    if (tariff.capacity_charge) {
      const capacityIndex = (tariff.variable || []).findIndex(function (row) {
        return String(row && row.label || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/ł/g, "l").indexOf("oplata mocowa") !== -1;
      });
      if (capacityIndex < 0) throw new Error("Brak składnika opłaty mocowej w taryfie " + tariff.code);
      const grossRate = number(tariff.variable[capacityIndex].price, "opłata mocowa brutto");
      const netRate = number(result.variable[capacityIndex].price, "opłata mocowa netto");
      if (grossRate <= 0) throw new Error("Nieprawidłowa stawka opłaty mocowej brutto.");
      const basisFactor = netRate / grossRate;
      result.capacity_charge = Object.assign({}, tariff.capacity_charge, {
        variable_rate: netRate,
        flat_monthly: (tariff.capacity_charge.flat_monthly || []).map(function (band) {
          return Object.assign({}, band, { amount: number(band.amount, "opłata mocowa miesięczna") * basisFactor });
        })
      });
    }
    [ ["buy_base", "buyBase"], ["sell_fixed_price", "sellFixedPrice"] ].forEach(function (spec) {
      const value = canonical[spec[1]];
      if (!value) throw new Error("Brak podstawy ceny " + spec[0]);
      result[spec[0]] = number(value.net, spec[0]);
    });
    if (String(tariff.sell_method).toLowerCase() === "rdn") {
      const market = canonical.market;
      if (!market || market.verified !== true) {
        throw new Error("Taryfa " + tariff.code + ": dodatki RDN wymagają potwierdzenia podstawy VAT.");
      }
      result.osd_add_rdn = number(market.margin.net, "marża RDN");
      result.osd_add_akcyza = number(market.excise.net, "akcyza");
    }
    return result;
  }

  function caption() {
    const vat = rates.length ? " · VAT " + rates.map(rate => (rate * 100).toLocaleString("pl-PL") + "%").join(" / ") : "";
    return "Ceny " + (basis === "net" ? "netto" : "brutto") + vat;
  }

  // Business stations are active VAT payers (confirmed by the owner).
  // Input is the nominal deposit value, already including the statutory uplift, NOT raw RCE.
  function settlementAmount(value, tariff) {
    if (value === null || value === undefined) return value;
    const mode = tariff ? tariff.priceBasis : basis;
    if (mode !== "net") return value;
    const canonical = tariff && legacy(tariff).pricing && legacy(tariff).pricing.tariffStorage;
    const rate = number(tariff ? canonical && canonical.vatRate : settlementVatRate, "VAT sprzedaży");
    if (rate < 0 || rate > 1) throw new Error("Nieprawidłowa stawka VAT sprzedaży.");
    return number(value, "wartość rozliczenia") / (1 + rate);
  }

  function saleCaption() {
    return basis === "net"
      ? "Sprzedaż netto · VAT " + (settlementVatRate * 100).toLocaleString("pl-PL") + "%"
      : "Wartość do depozytu · bez doliczania VAT";
  }

  function saleDescription() {
    return basis === "net"
      ? "RCE × 1,23 / (1 + VAT sprzedaży). Współczynnik depozytu i VAT są rozliczane osobno."
      : "RCE × 1,23: wartość do depozytu prosumenckiego. Współczynnik 1,23 nie jest doliczanym VAT.";
  }

  function refreshLabels() {
    if (!root.document) return;
    root.document.querySelectorAll("[data-price-basis-label], .summary-card__footnote, .summary-bill-card__note").forEach(function (element) {
      const sale = Boolean(element.closest("#sale-detail"));
      element.textContent = sale ? saleCaption() : caption();
      element.title = saleDescription();
    });
    root.document.body.dataset.priceBasis = basis;
  }

  function configure(target) {
    basis = resolveBasis(legacy(target));
    const canonical = legacy(target).pricing && legacy(target).pricing.tariffStorage;
    settlementVatRate = canonical ? number(canonical.vatRate, "VAT sprzedaży") : null;
    rates = canonical ? Array.from(new Set([].concat(canonical.fixed || [], canonical.variable || []).map(row => number(row.vatRate, "VAT")))).sort() : [];
    refreshLabels();
  }

  function projectPayload(payload) {
    const data = payload.tariffData;
    if (!data || !data.next) return payload;
    configure(data.next);
    stationConfigured = true;
    const next = projectTariff(data.next), current = projectTariff(data.current);
    let history = payload.tariffHistory;
    if (history && history.byDate) {
      const projected = new Map();
      history = root.ReTariffEngine.expand(history);
      history = Object.assign({}, history, { byDate: Object.fromEntries(Object.entries(history.byDate).map(entry => {
        if (!projected.has(entry[1])) projected.set(entry[1], projectTariff(entry[1]));
        return [entry[0], projected.get(entry[1])];
      })) });
    }
    const result = Object.assign({}, payload, {
      tariffData: Object.assign({}, data, {next, current}), tariffHistory: history,
      pricingDisplay: {basis, version: VERSION}
    });
    // Raw device/API money has the legacy basis. The existing Re ledger supplies business totals.
    if (basis === "net" && payload.energy) {
      result.energy = Object.assign({}, payload.energy, {dailyBillPln:null, dailySavingsPln:null, purchasePricePln:null});
    }
    return result;
  }

  function projectReResponse(response, target) {
    if (!response || !response.ok || !response.data || !response.data.tariff_id) return response;
    if (target && !stationConfigured) configure(response.data);
    return Object.assign({}, response, {data:projectTariff(response.data)});
  }

  function componentLabels(tariff) {
    const original = legacy(tariff);
    const canonical = original && original.pricing && original.pricing.tariffStorage;
    if (!canonical) return [];
    return [].concat(canonical.fixed || [], canonical.variable || []).map(function (row) {
      return {label:row.label + (row.window_code && row.window_code !== "all" ? " (" + row.window_code + ")" : ""),
        basis:(basis === "net" ? "netto" : "brutto") + " · VAT " + (number(row.vatRate, row.label) * 100).toLocaleString("pl-PL") + "%"};
    });
  }

  const api = {version:VERSION, resolveBasis, legacy, projectTariff, projectPayload, projectReResponse, refreshLabels, caption, componentLabels,
    settlementAmount, saleCaption, saleDescription,
    get basis() { return basis; },
    get cacheKey() { return VERSION + ":" + basis; }
  };
  root.DashboardPricing = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : globalThis);
