# Interrupted at the user's request

At 2026-10-04 05:32 UTC the user stopped the 10 Hz search and requested a
one-million-actor 5 Hz test instead. The isolated 812,500-actor database
`one-market-explore-10hz-812500-normal-20261004t053209z-1160117` was explicitly
paused at 05:32:51–52 UTC; a server SQL read confirmed `enabled=false`.
The harness then finished collecting and auditing the partial evidence.

The immutable artifact contains 364 committed tick receipts, ending at intended
slot 368 of the planned 400, with five skipped slots. Its `EXPLORE_FAIL` and
incomplete/stalled-evidence reasons are preserved, not overwritten. This was
not a completed comparison and must not be presented as a fresh passing probe
or used to calculate a clean 812.5k capacity boundary. Accounting passed, every
actor remained ACTIVE, and no floor ticks or zero-volume ticks were observed.

No database rows were deleted. No Maincloud changes were made for this probe.
