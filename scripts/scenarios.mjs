// npm run scenarios: replays every guardrail scenario and prints its journal.
import { SCENARIOS } from '../engine/scenarios.js';
import { clockLabelSec } from '../engine/time.js';
for (const s of SCENARIOS) {
  const r = s.run();
  console.log(`\n${s.title}\n  expected: ${s.expect}\n  requests that reached the simulator: ${r.writes}`);
  for (const j of r.journal) console.log(`  ${clockLabelSec(j.at)}  ${j.kind.padEnd(14)} ${j.text}`);
}
