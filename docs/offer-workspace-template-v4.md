# Offer Workspace Template V4

Renderer V4 is selected explicitly with:

```ts
renderOfferWorkspaceDocument(workspace, draft, { templateKey: 'REFORM_B2C/2026_10_V4' })
```

Calls without `templateKey` continue to render V3. The ten original V4 SVG files are stored under `assets/offer-templates/REFORM_B2C/2026_10_V4/`; `offer-template-v4.ts` pins their SHA-256 hashes, page dimensions, and every unique `#b2c_..._strona_XX` field. Rendering changes text values and data-bearing chart series only. Repeated decorative IDs on pages 5–8 are deliberately not used for selection.

## Data Contract

`OfferWorkspaceDocumentData` accepts optional `calculation?: OfferWorkspaceCalculation | null`. Only the authoritative server-calculated result should be passed. When absent, all forecast and billing result fields are rendered as explicit dashes and sample series are cleared. `workspace.energy` remains the source for current/baseline energy; it is never copied to forecast fields.

- Page 1–2: project/client identity, report details, installation description, existing PV power and current settlement are read from workspace/draft fields. Unknown report details and the five storage-dimension slots remain missing unless the source field is present.
- Page 3: measured import/export comes from `workspace.measurements`; load, PV production, and PV self-consumption come from `workspace.energy`. Monthly hash fields are matched by calendar month, not source-array order.
- Page 4: modeled totals and monthly load/PV/self-consumption come from `calculation.forecastEnergy`; grid import/export can come from `calculation.forecastMeasurements`; forecast flow rows may supply those values when the corresponding aggregate is absent. Billing value fields use `proposedBill` totals. No current energy is used as a forecast fallback.
- Pages 5–8: the upper/current panel uses current workspace energy and measurements. The lower/target panel is populated only from calculation forecast data for the selected Warsaw local date. When `forecastFlows` are present they supply load, PV, direct use, import/export and battery flows; otherwise the forecast energy and measurement profiles must match that same date. Battery fields cover battery-to-load, grid/PV charging and battery export; the template has no SOC value field.
- Page 9: annual bills and savings use calculation amounts; detailed cash, import/export, deposit, coverage, and bill totals use `baselineBill`/`proposedBill`. Individual tariff-rate components are not inferred from aggregate bills.
- Page 10: selected template items and their current catalog prices use the existing pricing helper, displaying system cost before financing. Grant, tax relief, and post-financing cost are shown only when present in calculation. They are not derived by the renderer.

For daily billing values, the renderer joins each forecast flow to billing intervals by the exact pair `(startUtc, endUtc)`. A daily sum is omitted if any required interval is missing or has a non-finite amount. Daily savings additionally requires matching baseline and proposed bill intervals for every flow. Monthly battery-to-load totals use `forecastFlows.batteryToLoadKwh`; daily battery fields use the corresponding exact-date flow rows. No financing, payback, tariff, or savings estimate is synthesized.

The renderer reports calculation warnings, blocked reasons, and forecast-energy quality/source/model/issues in `limitations`; mapped inputs are also listed in `sourceFieldsUsed`. Numeric fields with no source value remain `—`, and missing-data entries identify the corresponding SVG field.

## Data Still Needed

- Tariff names and resolved unit rates by time band, including the separate page 9 variable, quality, OZE, cogeneration, trade, fixed-network, power, subscription, and per-kWh values. `OfferBillingScenarioResult` contains resulting costs, not the tariff component rates. The duplicated page 9 ID `#b2c_skladnik_staly_sieciowy_aktualny_strona_09_2` denotes the power fee; it remains blank until that component is explicitly provided.
- Per-module storage dimensions for page 2; current workspace template capacity is aggregate and does not establish module dimensions.
- Any offer/reference number, if it is expected in the `nr_reform` slots; no such identifier is present in the document input contract.
- Average unit prices on pages 4–8 if those values are required independently from billing interval amount totals; the renderer does not infer a displayed tariff price from a blended total.

The billing contract provides `baselineBill` and `proposedBill`; the energy contract provides baseline `workspace.energy` and forecast `calculation.forecastEnergy`. `forecastFlows` is optional and should contain validated UTC interval boundaries from the same authoritative calculation as the billing results.
