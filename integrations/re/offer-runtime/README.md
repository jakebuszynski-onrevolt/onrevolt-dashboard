# Isolated offer runtime

`prosumer-engine.js` is based on the existing public dashboard engine retrieved
on 2026-10-29 from
`https://my.onrevolt.com/js/prosumer-engine.js`.

Original SHA-256: `ad07f2c133d3056a2b6fd1811e97cab524e573db8f3c2cbc7132958af7276e65`.

Diagnostic revision SHA-256: `1c09e3f720567e89265eda570568866c6339adf9ad46cf53a3f83f4486b2fa6b`.

The local diagnostic revision corrects two expressions in
`evaluatePlanningTransition`: grid charging energy and its unit cost are divided
by charge efficiency, consistently with the existing PV path. This patch has
not been deployed to the dashboard or inverter control. A shared-engine rollout
and parity check are required before offer pricing is enabled. The adapter's
power limits are AC; it converts them to stored-energy transition limits. An
initial SOC outside the discrete state grid is rejected, not rounded.

The diagnostic adapter calls `simulateDay`, not `simulateRange` (the latter
replaces an explicit zero battery with its default). It supplies every interval,
price and physical battery parameter explicitly. The worker receives no database
credentials, network API, station identity or control endpoints. Changing this
snapshot requires updating its hash and running the adapter regression tests.

This is **not yet an offer pricing engine**. Fixed charges, net-metering baseline,
PV/load reconstruction, deposit expiry and long-term economics must be connected
and verified before it may produce an offer recommendation. Physical balance
errors are returned as blocking diagnostics, never hidden by adjusted inputs.
