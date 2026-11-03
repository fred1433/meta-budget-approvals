// Every guardrail the page lets you try, replayed on the same engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../engine/scenarios.js';
import { createWorld } from '../engine/world.js';

const run = (id) => SCENARIOS.find((s) => s.id === id).run();

test('two clicks on the same approval = one authorization and one request', () => {
  const r = run('double-approve');
  assert.equal(r.sameAuth, true);
  assert.deepEqual(r.outcomes, ['executed', 'already_executed']);
  assert.equal(r.writes, 1);
  assert.equal(r.budget, 11000);
});

test('budget edited after approval = approval void, nothing sent', () => {
  const r = run('edited-after-approval');
  assert.equal(r.outcome, 'refused_state_changed');
  assert.equal(r.writes, 0);
  assert.equal(r.budget, 13000, 'the human edit stands');
  assert.match(r.journal.at(-1).text, /covered \$100\.00 to \$110\.00, but the budget reads \$130\.00/);
});

test('expired approval = new approval needed, nothing sent', () => {
  const r = run('expired');
  assert.equal(r.outcome, 'expired');
  assert.equal(r.writes, 0);
});

test('stale or incomplete data = increase held with its reason', () => {
  const r = run('stale-data');
  assert.equal(r.outcome, 'held_data');
  assert.equal(r.writes, 0);
  assert.match(r.journal.at(-1).text, /6 of 7 days/);
});

test('stale Meta read = held', () => {
  const w = createWorld();
  const p = w.propose('SIM-AS-101');
  const a = w.executor.approve(p);
  w.status.metaReadMs -= 7 * 3600 * 1000;
  assert.equal(w.executor.execute(a.id).outcome, 'held_data');
  assert.equal(w.sim.received.length, 0);
});

test('response lost after sending = unknown, verified before any retry, one write in total', () => {
  const r = run('lost-response');
  assert.deepEqual(r.outcomes, ['unknown', 'needs_verification', 'executed']);
  assert.equal(r.writes, 1);
  assert.equal(r.budget, 11000, 'absolute target: a retry can never compound to $121');
});

test('lost response that did NOT apply can be retried with the same absolute target', () => {
  const w = createWorld();
  const p = w.propose('SIM-AS-101');
  const a = w.executor.approve(p);
  // Simulate a request that never reached the server: the transport throws before applying.
  const orig = w.sim.handle.bind(w.sim);
  let first = true;
  w.sim.handle = (req) => { if (req.method === 'POST' && first) { first = false; const e = new Error('lost'); e.code = 'RESPONSE_LOST'; throw e; } return orig(req); };
  assert.equal(w.executor.execute(a.id).outcome, 'unknown');
  assert.equal(w.executor.verify(a.id).outcome, 'not_applied');
  assert.equal(w.executor.execute(a.id).outcome, 'executed');
  assert.equal(w.sim.objects['SIM-AS-101'].daily_budget_cents, 11000);
});

test('several admissible increases one by one = cumulative effect checked against the morning budget', () => {
  const r = run('cumulative');
  assert.deepEqual(r.outcomes, ['executed', 'refused_cumulative_cap']);
  assert.deepEqual(r.second, [11000, 12100]);
  assert.equal(r.writes, 1);
  assert.equal(r.budget, 11000);
});

test('stop = no new sends; a request already sent stays uncertain until verified', () => {
  const r = run('stop-in-flight');
  assert.deepEqual(r.outcomes, ['unknown', 'stopped', 'executed']);
  assert.equal(r.writes, 1);
  const uncertain = r.journal.find((j) => /stays uncertain until verified/.test(j.text));
  assert.ok(uncertain, 'the in-flight request is reported as uncertain, not cancelled');
  assert.ok(!r.journal.some((j) => /cancel/i.test(j.text)));
});

test('stop does not pause ads: no status write is ever prepared', () => {
  const r = run('stop-in-flight');
  assert.ok(r.journal.some((j) => /Your ads keep running/.test(j.text)));
});

test('going back to $100 after execution = a new approval, not an undo', () => {
  const r = run('go-back');
  assert.equal(r.outcome, 'executed');
  assert.equal(r.newAuth, true);
  assert.equal(r.writes, 2);
  assert.equal(r.budget, 10000);
  assert.match(r.note, /does not refund spend/);
});

test('going back is refused if someone edited the budget since', () => {
  const w = createWorld();
  const p = w.propose('SIM-AS-101');
  const a = w.executor.approve(p);
  w.executor.execute(a.id);
  w.sim.humanEdit('SIM-AS-101', 12500);
  const back = w.executor.revertProposal(a.id);
  const b = w.executor.approve(back);
  assert.equal(w.executor.execute(b.id).outcome, 'refused_state_changed');
  assert.equal(w.sim.objects['SIM-AS-101'].daily_budget_cents, 12500);
});

test('an approval above the +10% step limit is refused at approval time', () => {
  const w = createWorld();
  const p = { ...w.propose('SIM-AS-101'), toCents: 13500 };
  assert.equal(w.executor.approve(p), null);
});

test('the authorization names object, start value, absolute target, conditions and expiry', () => {
  const w = createWorld();
  const a = w.executor.approve(w.propose('SIM-AS-101'));
  assert.equal(a.objectId, 'SIM-AS-101');
  assert.equal(a.fromCents, 10000);
  assert.equal(a.toCents, 11000);
  assert.ok(a.conditions.length >= 4);
  assert.equal(a.expiresAt - a.approvedAt, 30 * 60 * 1000);
});
