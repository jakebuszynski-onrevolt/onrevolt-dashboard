<?php
require_once __DIR__ . '/re_config.php';

$reDataStartDate = re_data_start_date();
?>
<!DOCTYPE html>
<html lang="pl">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />
  <title>Schemat przepływu energii prosumenta</title>

  <!-- Bootstrap -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" />
  <link href="css/styles.css?v=20260804b" rel="stylesheet" />
  <link href="css/styles-dark.css" rel="stylesheet" />
  <script defer src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
</head>

<body class="re-onrevolt-embed">

  <!-- =========================  GŁÓWNA TABELA  ========================= -->
  <table class="layout-table">

    <!-- ========== 1. MINI-DIAGRAM ========== -->
    <tr>
      <td class="left">
        <div class="panel-1200" style="height:335px;">

          <!-- pasek adresu + taryfa -->
          <div class="position-absolute top-0 start-0 p-3 d-flex align-items-center gap-2 flex-wrap">
            <!-- Adres -->
            <label class="fw-bold mb-0" for="addrInput">Adres:</label>
            <input id="addrInput" class="form-control form-control-sm" style="width:360px" placeholder="np. Aleja Sikorskiego 12, Łódź" />
            <button id="addrSearchBtn" class="btn btn-sm btn-primary">Szukaj</button>

            <!-- selektor taryfy -->
            <label class="fw-bold mb-0 ms-3" for="tariffSelect">Taryfa:</label>
            <select id="tariffSelect" class="form-select form-select-sm w-auto">
              <option>G11 – 89% ludności Polski</option>
              <option>G11 + PV (net-metering, instalacja do 31 III 2022)</option>
              <!--			<option>G11 + PV (net-billing, instalacja od 1 IV 2022)</option>
			<option>G12 + PV (net-metering, instalacja do 31 III 2022)</option>
			<option>G12 + PV (net-billing, instalacja od 1 IV 2022)</option> 
-->
            </select>
            <button id="TarifSetBtn" class="btn btn-sm btn-primary">Ustaw</button>
          </div>

          <!-- kontener ikon -->
          <div id="topPanel" class="panel-icons mini">
            <img id="factoryTop" class="svg-invert icon" data-removed-src="images/power-plant.svg" style="scale:1.3; margin-top:100px" alt="Elektrownia" />
            <svg id="flowTop" class="flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path id="pipeTop" class="flow-pipe alt-red" d="" />
              <path id="flowDotsTop" class="flow-dots alt-red" d="" />
            </svg>
            <svg id="flowTop2" class="flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path id="pipeTop2" class="flow-pipe alt-yellow" d="" />
              <path id="flowDotsTop2" class="flow-dots alt-yellow" d="" />
            </svg>
            <img id="homeTop" class="svg-invert icon" data-removed-src="images/house.svg" style="margin-top:20px" alt="Dom" />
            <img id="solarImg1" class="svg-invert icon" data-removed-src="images/solar-panels.svg" style="margin-top:50px" alt="Panele fotowoltaiczne" />
          </div>

          <!-- strzałka SVG -->
          <svg class="mini-arrow" width="380" height="20">
            <defs>
              <marker id="arrowMini" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0,10 3.5,0 7" fill="#000" />
              </marker>
            </defs>
            <line x1="0" y1="10" x2="380" y2="10" marker-end="url(#arrowMini)" />
          </svg>
        </div>
      </td>

      <td class="right">
        <div id="Right1Card" class="card sidebar-220 shadow-sm">
          <div class="card-body p-3">
            <h6 class="fw-bold">Rachunki za prąd</h6>
            <ul id="bilansMini" class="list-unstyled small mb-0"></ul>
          </div>
        </div>
      </td>
    </tr>

    <!-- ========== 2. GŁÓWNY DIAGRAM ========== -->
    <tr>
      <td class="left">
        <div class="panel-1200" style="height:335px;">
          <svg id="flowBottom2" class="flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path id="pipeBottom2" class="flow-pipe alt-red-slow" d="" />
            <path id="flowDotsBottom2" class="flow-dots alt-red-slow" d="" />
          </svg>
          <svg id="flowBottom3" class="flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path id="pipeBottom3" class="flow-pipe" d="" />
            <path id="flowDotsBottom3" class="flow-dots" d="" />
          </svg>
          <svg id="flowBottom4" class="flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path id="pipeBottom4" class="flow-pipe alt-yellow" d="" />
            <path id="flowDotsBottom4" class="flow-dots alt-yellow" d="" />
          </svg>

          <div class="panel-icons">
            <img id="plantImg" class="svg-invert icon" data-removed-src="images/power-plant.svg" alt="Elektrownia" />
            <img id="windImg" class="svg-invert icon" data-removed-src="images/wind-turbine.svg" alt="Turbina wiatrowa" />
            <img id="solarImg" class="svg-invert icon" data-removed-src="images/solar-panels.svg" alt="Panele fotowoltaiczne" />
            <img id="bankImg" class="svg-invert icon" data-removed-src="images/prosumer-deposit.svg" alt="Depozyt prosumencki" />
          </div>
          <div class="panel-icons2">
            <img id="houseopt" class="iconhouse svg-invert icon" data-removed-src="images/house.svg" alt="Dom" />
            <img id="batteryImg" class="iconbattery" data-removed-src="images/battery-pack.svg" alt="Magazyn energii" />
          </div>
        </div>
      </td>

      <td class="right">
        <div id="Right2Card" class="card sidebar-220 shadow-sm">
          <div class="card-body p-3">
            <h6 class="fw-bold">Rachunki po optymalizacji</h6>
            <ul id="bilansMain" class="list-unstyled small mb-0"></ul>
          </div>
        </div>
      </td>
    </tr>

    <!-- ========== 3. PANEL INTERAKTYWNY + ReVolt ========== -->
    <tr>
      <td class="left">
        <div class="panel-1200 p-3">
          <div data-price-basis-label style="margin-bottom:12px;font-size:14px;line-height:1.4;color:inherit"></div>
          <div class="d-flex align-items-center gap-3 flex-wrap mb-3">
            <div class="d-flex align-items-center gap-3 flex-wrap w-100">
            <!-- Dostawca -->
            <label class="fw-bold mb-0" for="providerSelect">Dostawca prądu:</label>
            <select id="providerSelect" class="form-select form-select-sm" style="width:auto; min-width:90px;">
              <option>ENEA</option>
              <option>ENERGA</option>
              <option>TAURON</option>
              <option>PGE</option>
            </select>

            <!-- Taryfa uproszczona -->
            <label class="fw-bold mb-0" for="tariffShort">Taryfa:</label>
            <select id="tariffShort" class="form-select form-select-sm" style="width:auto; min-width:180px;">
              <option>G11</option>
              <option>G12</option>
              <option>Dynamiczna</option>
            </select>

            <div id="billingCycleWrap" class="d-flex align-items-center gap-2">
              <label class="fw-bold mb-0" for="billingCycleMonths">Rozliczenie:</label>
              <select id="billingCycleMonths" class="form-select form-select-sm" style="width:140px;">
                <option value="1" selected>1 miesiąc</option>
                <option value="2">2 miesiące</option>
                <option value="6">6 miesięcy</option>
                <option value="12">12 miesięcy</option>
              </select>
            </div>

            <input type="checkbox" id="cSell" checked style="display:none!important;" aria-hidden="true" tabindex="-1" />

            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="useRcem" />
              <label class="form-check-label" for="useRcem">RCEm</label>
            </div>

            <div id="contractPowerWrap" class="d-none d-flex align-items-center gap-2">
              <label class="fw-bold mb-0" for="contractPowerKw">Moc umowna:</label>
              <input id="contractPowerKw" type="number" class="form-control" value="16" min="0" step="1" style="width:82px;" />
              <span>kW</span>
            </div>
            </div>

            <div class="d-flex align-items-center gap-3 flex-wrap w-100">
            <!-- Roczne zużycie -->
            <label class="fw-bold mb-0" for="annualUsage">Roczne zużycie startowe:</label>
            <span class="d-flex align-items-center gap-2">
              <input id="annualUsage" type="number" class="form-control" value="4000" min="0" step="1" /> kWh
              <button id="usageProfileToggle" class="btn btn-sm btn-outline-warning usage-profile-toggle" type="button" title="Profil zużycia" aria-controls="usageProfilePanel" aria-expanded="false">⚙</button>
            </span>

            <div class="form-check d-flex align-items-center gap-2">
              <input class="form-check-input" type="checkbox" id="bankEnergy" checked>
              <label class="form-check-label mb-0" for="bankEnergy">Bank Energii</label>
              <select id="bankV" class="form-select" style="width:96px;">
			    <option value="0">0 kWh</option>
                <option value="5">5 kWh</option>
                <option value="10">10 kWh</option>
                <option value="15" selected>15 kWh</option>
              </select>
            </div>

            <input type="checkbox" id="cWind" style="display:none!important;" aria-hidden="true" tabindex="-1" />
            <input id="windV" type="hidden" value="0" aria-hidden="true" tabindex="-1">

            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="cPV" checked />
              <label class="form-check-label" for="cPV">Panele słoneczne</label>
            </div>

            <!-- Moc PV -->
            <span class="d-flex align-items-center gap-2">
              <label class="mb-0" for="pvPower">Moc PV:</label>
              <input id="pvPower" type="number" class="form-control" value="4000" min="0" step="500" disabled /> W
            </span>
            </div>
          </div>

          <div id="usageForecastSummary" class="small my-2" aria-live="polite"></div>

          <!-- Suwak dat -->
          <label for="dateRange" class="form-label fw-bold">
            Zakres dat: <span id="dateLabel"><?= htmlspecialchars(re_date_label_pl($reDataStartDate), ENT_QUOTES, 'UTF-8') ?></span>
          </label>
          <input type="range" class="form-range w-100" id="dateRange" min="0" max="364" value="0" />
        </div>

        <div id="usageProfilePanel" class="panel-1200 usage-profile-panel p-3 mt-3" hidden>
          <div class="usage-profile-head">
            <div>
              <h5 class="mb-1">Profil zużycia</h5>
              <div id="usageProfileTotal" class="usage-profile-total"></div>
            </div>
            <div class="usage-profile-actions">
              <span id="usageProfileStatus" class="usage-profile-status"></span>
              <input id="usageProfileFile" class="usage-profile-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
              <label id="usageProfileUpload" class="btn btn-sm btn-outline-warning mb-0" for="usageProfileFile">Wstaw XLSX</label>
              <button id="usageProfileSave" class="btn btn-sm btn-primary" type="button">Zapisz</button>
            </div>
          </div>
          <div id="usageMonthsChart" class="usage-months-grid" aria-label="Zużycie miesięczne"></div>
          <div class="usage-day-profile">
            <h6 class="mb-2">Rozkład zużycia w trakcie dnia</h6>
            <div id="usageDayProfileChart" class="usage-day-grid" aria-label="Rozkład dobowy zużycia"></div>
          </div>
        </div>

        <!-- ========== 4. RCE ========== -->
        <div class="panel-1200 p-3 mt-3">
          <h5 id="rceTitle" class="mb-3">Ceny RCE*1.23 [zł/kWh]</h5>
          <div class="chart-container p-3">
            <canvas id="rceChart"></canvas>
          </div>
        </div>


      </td>

      <td class="right">

        <div id="Card" class="card sidebar-220 shadow-sm small">
          <div class="card-body p-3">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="cAddMonth" checked />
              <label class="form-check-label" for="cAddMonth">+koszty miesięczne</label>
            </div>
          </div>
        </div>

        <div id="revoltCard" class="card sidebar-220 shadow-sm">
          <div class="card-body p-3 small">
            <h6 class="fw-bold">Bilans systemu Re:Volt</h6>
            <p class="mb-1">Stary rachunek: <span id="g11Sum" style="color: red;">0 zł</span></p>
            <p class="mb-1">Bilans Re:Volt: <span id="rvSum">0 zł</span></p>
            <hr class="my-2" />
            <p class="mb-1">Depozyt <span id="depositSum">0.1 zł</span></p>
            <p class="mb-1">30% depozytu (informacyjnie): <strong id="depositSumPrc">0.1 zł</strong></p>
            <hr class="my-2" />
            <p class="mb-1"><strong>Nowy rachunek: </strong><strong id="depositSumAll" style="color: green;">0.1 zł</strong></p>
            <p class="mb-1">Oszczędność: <strong id="savingSum">0 zł</strong></p>
              <div class="d-flex justify-content-end gap-2 mt-3">
                <button id="downloadCsvDay" class="btn btn-sm btn-outline-warning">Pobierz CSV (dzień)</button>
                <button id="downloadCsvYear" class="btn btn-sm btn-outline-warning">Pobierz CSV (rok)</button>
              </div>
            </div>
        </div>
        <br>
        <div id="revoltCard3" class="card sidebar-220 shadow-sm small">
          <div class="card-body p-3">
            <h6 class="fw-bold">Bilans Dnia:</h6>
            <p class="mb-1">Zużycie : <span id="day_use">0,00 kWh</span></p>
            <p class="mb-1">Uzysk PV : <span id="day_PV">0,00 kWh</span></p>
            <p class="mb-1" style="display: none;">Uzysk Turbina : <span id="day_wind">0,00 kWh</span></p>
            <p class="mb-1">Kupno : <span id="day_bayV">0,00 kWh</span><span id="day_bay">0,00 zł</span></p>
            <p class="mb-1">Sprzedaż : <span id="day_sellV">0,00 kWh</span><span id="day_sell">0,00 zł</span></p>
            <p class="mb-1">Kupno bank : <span id="day_bank_bayV">0,00 kWh</span><span id="day_bank_bay">0,00 zł</span></p>
            <p class="mb-1">Sprzedaż bank : <span id="day_bank_sellV">0,00 kWh</span><span id="day_bank_sell">0,00 zł</span></p>
            <hr class="my-2" />
            <p class="mb-1">Bilans dnia : <span id="day_sum">0,00 zł</span></p>
          </div>
        </div>
      </td>
    </tr>


    <tr>
      <td class="left">

      </td>
      <td class="right"></td>
    </tr>

  </table><!-- /layout-table -->

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="re_config.js.php?v=20260717a"></script>
  <script src="js/others.js?v=20260717a"></script>
  <script src="js/re-consumption-engine.js?v=20260909-shared-profile"></script>
  <script src="js/scripts.js?v=20260930-capacity-charge-2"></script>

</body>

</html>
