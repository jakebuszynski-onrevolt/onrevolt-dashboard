'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const expectedHash = '1c09e3f720567e89265eda570568866c6339adf9ad46cf53a3f83f4486b2fa6b';
const enginePath = path.join(__dirname, '..', 'integrations', 're', 'offer-runtime', 'prosumer-engine.js');
const code = fs.readFileSync(enginePath, 'utf8');
if (createHash('sha256').update(code).digest('hex') !== expectedHash) {
  throw new Error('Zmieniła się przypięta wersja silnika RE');
}
let json = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  json += chunk;
  if (Buffer.byteLength(json) > 32 * 1024 * 1024) process.exit(2);
});
process.stdin.on('end', () => {
  try {
    const context = vm.createContext({ window: {} }, { codeGeneration: { strings: false, wasm: false } });
    // The sandbox receives JSON only, never process, require, network, station credentials or DOM.
    // Bind the VM's own intrinsics once; repeated global-proxy lookups dominate the SOC loop.
    const scopedCode = `(function(Math, Number, Object, Array, String, Boolean, Date, JSON, Map, Set) {\n${code}\n})(Math, Number, Object, Array, String, Boolean, Date, JSON, Map, Set);`;
    vm.runInContext(scopedCode, context, { filename: enginePath, timeout: 3000 });
    context.inputJson = json;
    const result = vm.runInContext(`(() => {
      const input = JSON.parse(inputJson);
      const engine = window.DashboardProsumerEngine;
      const days = input.days;
      const battery = input.battery;
      let state = { socKwh: input.initialSocKwh, depositPln: input.initialDepositPln, cycleCount: 0 };
      const provider = { getSlotPrice: (_date, slot) => slot.price };
      const output = [];
      for (let index = 0; index < days.length; index++) {
        const result = engine.simulateDay({
          dayStart: { dateKey: days[index].dateKey, ...state },
          battery, priceProvider: provider, slots: days[index].slots,
          planningSlots: days.slice(index, index + 2).flatMap(day => day.slots),
          options: { initialSocKwh: input.initialSocKwh, initialDepositPln: input.initialDepositPln,
            socStepKwh: input.socStepKwh, planningHorizonDays: 2 }
        });
        state = result.stateOut;
        output.push(result);
      }
      return JSON.stringify({ days: output, finalState: state });
    })()`, context, { timeout: 120000 });
    process.stdout.write(result);
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});
