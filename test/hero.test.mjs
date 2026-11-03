// The 90-second path on the page: approve, edit the budget yourself, run (refused), replay without the edit, run (executed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../engine/world.js';

test('point-2 path end to end', () => {
  let w = createWorld();
  let p = w.propose('SIM-AS-101');
  assert.equal(p.verdict, 'increase');
  assert.equal(p.fromCents, 10000);
  assert.equal(p.toCents, 11000);
  w.executor.recommend(p);
  let a = w.executor.approve(p);
  assert.equal(a.status, 'approved');
  w.sim.humanEdit('SIM-AS-101', 13000);
  let r = w.executor.execute(a.id);
  assert.equal(r.outcome, 'refused_state_changed');
  assert.equal(w.sim.received.length, 0);

  w = createWorld();
  p = w.propose('SIM-AS-101');
  w.executor.recommend(p);
  a = w.executor.approve(p);
  r = w.executor.execute(a.id);
  assert.equal(r.outcome, 'executed');
  assert.equal(r.readback, 11000);
  assert.equal(w.sim.received.length, 1);
  assert.equal(w.sim.received[0].body.daily_budget, '11000');
});
