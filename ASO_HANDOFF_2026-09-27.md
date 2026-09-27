# ASO / retention implementation — 27 September 2026

This work coexists with the React Native upgrade and other in-progress edits.
Do not revert or commit all working-tree changes as a single ASO change.

Detailed implementation, changed-file list, test evidence, rollout checks and remaining work:
[Release handoff](../aso-reports/2026-09-27/implementation/release-handoff.md)

[Listing copy and experiment pack](../aso-reports/2026-09-27/implementation/listing-test-pack.md)

New functionality: bounded independent catalog loading with cached recovery, retry/status UI,
first-screen guest entry without the onboarding offer, device-language defaults, initial Russian
search aliases, and non-sensitive growth measurement. Blox's language selector is accessible
again; Adopt Me now has core-flow Russian translations with English fallback for advanced screens.

Validation: targeted tests pass in all three apps; all three Android production JavaScript bundles
compile. Native device/UI checks and Analytics DebugView verification remain after RN integration.
No native/dependency edits, store publication, push campaign or app release were performed by
this ASO work. MM2's old aliases were restored separately during this session: `data.json`,
`mm2.json`, and `mm2values.json` now return HTTP 200 with byte-identical valid JSON. They must
remain publishing outputs, and active old versions still need schema-compatibility verification.
