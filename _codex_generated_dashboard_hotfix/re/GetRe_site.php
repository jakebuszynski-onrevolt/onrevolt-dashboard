<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <title>TEST</title>
</head>
<body>

<script>window.HEADLESS = true;</script>

<!-- dane źródłowe z bazy -->
<script src="js/others.js"></script>

<!-- mock UI + wrapper roczny -->
<script src="js/script_on.js?v=20260930-capacity-charge-2"></script>

<!-- silnik (costBankPVWindSell + loadCurrentTariff) -->
<script src="js/re-consumption-engine.js?v=20260909-shared-profile"></script>
<script src="js/scripts.js?v=20260930-capacity-charge-2"></script>

<script>
(async () => {
  // ====== 1) ustaw “UI” (mocki) ======
  provider.value = '1';  // ENEA (to ma być REALNE osd_id z bazy, nie selectedIndex)
  tariff.value   = '23'; // REALNE tariff_id z bazy (jak na stronie)

  usage.value = '4000';
  pvInp.value = '4000';      // W (tylko “UI”)
  bankV.value = '15';
  windV.value = '0';
  contractPowerKw.value = '16';
  billingCycleMonths.value = '1';

  chkPV.checked   = true;
  chkWind.checked = false;
  chkSell.checked = true;
  chkBank.checked = true;

  // ====== 2) PV/WIND/RDN jak w UI: z bazy (get_dbdata.php) ======
  // others.js ma fetchSeries, fetchSeriesRDN, applyPV, applyWind, applyRDN
  const from = '2024-10-01';
  const to   = '2025-10-01';
  const lat = 52.434596;
  const lon = 16.822072;
  const [windData, pvData] = await Promise.all([
    fetchSeries('wind', lat, lon, from, to),
    fetchSeries('pv',   lat, lon, from, to),
  ]);
  applyWind(windData);
  applyPV(pvData);

  const rdnArray = await fetchSeriesRDN('rdn', from, to); // uwaga: ta funkcja jest w others.js
  applyRDN(rdnArray);

  // ====== 3) Taryfa runtime (MUST) ======
  await ensureTariffRuntime(Number(provider.value), Number(tariff.value));

  // ====== 4) SYMULACJA RAZ ======
  const res = simulateYearBankPVWindSell({
    startDateStr: '2024-10-01',
    days: 365,
    annualUsageKWh: 4000,
    kWp: 4.0,          // kWp (NIE 4000)
    initialSocKWh: 0
  });

  // ====== 5) To co pokazuje UI ======
  const bilansReVolt = res.yearCostCash;
  const depo = res.depositAfterYear;
  const depo30 = depo * 0.3;
  const nowyRachunek = Math.max(bilansReVolt, 0);

  console.log('RES=', res);
  console.log('Bilans Re:Volt=', bilansReVolt.toFixed(2));
  console.log('Depozyt=', depo.toFixed(2));
  console.log('30% depozytu (informacyjnie)=', depo30.toFixed(2));
  console.log('Nowy rachunek=', nowyRachunek.toFixed(2));
})();
</script>

</body>
</html>
