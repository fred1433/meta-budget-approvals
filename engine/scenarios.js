// The guardrail scenarios. The page's "Try to break it" buttons and the test suite run exactly these.
import { createWorld } from './world.js';

const A = 'SIM-AS-101';
const B = 'SIM-AS-102';

function base(opts) {
  const w = createWorld(opts);
  const p = w.propose(A);
  w.executor.recommend(p);
  w.advance(20);
  return { w, p };
}
const finish = (w, extra) => ({ journal: w.executor.journal, writes: w.sim.received.length, budget: w.sim.objects[A].daily_budget_cents, ...extra });

export const SCENARIOS = [
  {
    id: 'double-approve', title: 'Approve twice, run twice',
    expect: 'One authorization, one request.',
    run() {
      const { w, p } = base();
      const a1 = w.executor.approve(p); const a2 = w.executor.approve(p);
      w.advance(5); const r1 = w.executor.execute(a1.id); const r2 = w.executor.execute(a2.id);
      return finish(w, { sameAuth: a1 === a2, outcomes: [r1.outcome, r2.outcome] });
    },
  },
  {
    id: 'edited-after-approval', title: 'Someone edits the budget after you approve',
    expect: 'Approval void, nothing sent.',
    run() {
      const { w, p } = base();
      const a = w.executor.approve(p); w.advance(40);
      w.sim.humanEdit(A, 13000); w.advance(30);
      const r = w.executor.execute(a.id);
      return finish(w, { outcome: r.outcome });
    },
  },
  {
    id: 'expired', title: 'The approval is 31 minutes old',
    expect: 'Expired, a new approval is needed.',
    run() {
      const { w, p } = base();
      const a = w.executor.approve(p); w.advance(31 * 60);
      const r = w.executor.execute(a.id);
      return finish(w, { outcome: r.outcome });
    },
  },
  {
    id: 'stale-data', title: 'Yesterday\u2019s Shopify orders turn out incomplete',
    expect: 'Increase held, with the reason.',
    run() {
      const { w, p } = base();
      const a = w.executor.approve(p); w.advance(60);
      w.status.daysComplete = 6; w.status.incompleteReason = 'the Shopify order sync for Nov 2 is found incomplete'; // discovered before sending
      const r = w.executor.execute(a.id);
      return finish(w, { outcome: r.outcome });
    },
  },
  {
    id: 'lost-response', title: 'The response is lost after sending',
    expect: 'Result unknown, verified before anything else.',
    run() {
      const { w, p } = base();
      const a = w.executor.approve(p); w.advance(5);
      w.sim.faults.loseNextResponse = true;
      const r1 = w.executor.execute(a.id); w.advance(10);
      const r2 = w.executor.execute(a.id); w.advance(10);
      const v = w.executor.verify(a.id);
      return finish(w, { outcomes: [r1.outcome, r2.outcome, v.outcome] });
    },
  },
  {
    id: 'cumulative', title: 'Two +10% steps on the same morning',
    expect: 'The second is refused: +21% over the internal +20% per day.',
    run() {
      const { w, p } = base();
      const a1 = w.executor.approve(p); w.advance(5); const r1 = w.executor.execute(a1.id);
      w.advance(15 * 60);
      // A second rule proposes another +10% step from $110. Each step alone is within the +10% step limit.
      const read = w.adapter.read(A);
      const p2 = { ...p, id: 'P-SIM-AS-101-b', fromCents: 11000, toCents: 12100, observedUpdatedMs: read.updatedMs };
      w.executor.recommend(p2); w.advance(10);
      const a2 = w.executor.approve(p2); w.advance(5); const r2 = w.executor.execute(a2.id);
      return finish(w, { outcomes: [r1.outcome, r2.outcome], second: [p2.fromCents, p2.toCents] });
    },
  },
  {
    id: 'stop-in-flight', title: 'You stop the agent after a response was lost',
    expect: 'No new sends; the unanswered request stays uncertain until verified.',
    run() {
      const { w, p } = base();
      const a = w.executor.approve(p); w.advance(5);
      w.sim.faults.loseNextResponse = true;
      const r1 = w.executor.execute(a.id); w.advance(3);
      w.executor.stop(); w.advance(20);
      // Another change waiting: lowering the BOGO ad set to $135, a change you asked for. Stopped writes block it too.
      const rb = w.adapter.read(B);
      const other = { id: 'P-SIM-AS-102-down', kind: 'decrease', objectId: B, objectName: 'BOGO Boho Wraps, broad', fromCents: rb.dailyBudget, toCents: 13500, observedUpdatedMs: rb.updatedMs };
      w.executor.recommend(other); w.advance(5);
      const a2 = w.executor.approve(other); w.advance(5);
      const r2 = w.executor.execute(a2.id); w.advance(30);
      const v = w.executor.verify(a.id);
      return finish(w, { outcomes: [r1.outcome, r2.outcome, v.outcome] });
    },
  },
  {
    id: 'go-back', title: 'Go back to $100 after it ran',
    expect: 'A new change with its own approval, not an undo.',
    run() {
      const { w, p } = base();
      const a = w.executor.approve(p); w.advance(5); w.executor.execute(a.id); w.advance(120);
      const back = w.executor.revertProposal(a.id);
      w.executor.recommend(back); w.executor.log('recommendation', back.note, back.id); w.advance(10);
      const b = w.executor.approve(back); w.advance(5);
      const r = w.executor.execute(b.id);
      return finish(w, { outcome: r.outcome, newAuth: b.id !== a.id, note: back.note });
    },
  },
];
