// The executor turns an approval into at most one write, and only if the account still looks
// exactly like it did when the recommendation was made: same value, no edit since.
import { usd } from './money.js';
import { clockLabel, clockLabelSec, localDate } from './time.js';
import { prepareBudgetUpdate } from './metaAdapter.js';

export const DEFAULT_LIMITS = {
  approvalTtlMs: 30 * 60 * 1000, // an approval is valid for 30 minutes
  maxStepPct: 10, // one recommendation never asks for more than +10%
  maxDailyIncreasePct: 20, // internal rule on the agent's changes: +20% above this morning's budget per day, all changes combined
  maxDataAgeMs: { meta: 6 * 3600 * 1000, shopify: 2 * 3600 * 1000 },
};

export function authConditions(p, limits = DEFAULT_LIMITS) {
  const base = [`the budget still reads ${usd(p.fromCents)}, with no edit since the recommendation`, 'data fresh and complete'];
  if (p.toCents > p.fromCents) base.push(`within +${limits.maxDailyIncreasePct}% of this morning’s budget`);
  base.push('agent writes not stopped');
  return base;
}

export function absoluteNote(p) {
  return p.toCents > p.fromCents
    ? 'The target is absolute, so a retry cannot add another 10%.'
    : `The target is absolute: a retry sets ${usd(p.toCents)} again, never less.`;
}

export class Executor {
  constructor({ adapter, clock, limits = DEFAULT_LIMITS, dataStatus }) {
    this.adapter = adapter;
    this.clock = clock;
    this.limits = limits;
    this.dataStatus = dataStatus; // () => { metaReadMs, shopifyReadMs, daysComplete, daysExpected }
    this.auths = new Map();
    this.byProposal = new Map();
    this.ops = new Map();
    this.baselines = new Map(); // objectId -> { date, cents }
    this.stopped = false;
    this.journal = [];
    this.n = 0;
  }

  log(kind, text, ref = null) {
    const entry = { at: this.clock(), kind, text, ref };
    this.journal.push(entry);
    return entry;
  }

  // First budget read of the local day: the reference for the cumulative cap.
  baseline(objectId) {
    const today = localDate(this.clock());
    const b = this.baselines.get(objectId);
    if (b && b.date === today) return b.cents;
    const r = this.adapter.read(objectId);
    this.baselines.set(objectId, { date: today, cents: r.dailyBudget });
    return r.dailyBudget;
  }

  recommend(p) {
    this.baseline(p.objectId);
    return this.log('recommendation', `${p.objectName}: daily budget ${usd(p.fromCents)} to ${usd(p.toCents)}. Waiting for approval.`, p.id);
  }

  unresolvedFor(objectId, exceptAuthId = null) {
    for (const [id, rec] of this.ops) if (rec.status === 'unknown' && id !== exceptAuthId && this.auths.get(id).objectId === objectId) return id;
    return null;
  }

  approve(p, approver = 'you') {
    const key = `${p.id}|${p.objectId}|${p.fromCents}|${p.toCents}|${p.observedUpdatedMs ?? ''}`;
    const existing = this.byProposal.get(key);
    if (existing && ['approved', 'executed', 'unknown'].includes(existing.status)) {
      this.log('approval', `Second approval of ${existing.id} ignored: it is the same authorization, so there is still only one operation.`, existing.id);
      return existing;
    }
    const step = ((p.toCents - p.fromCents) / p.fromCents) * 100;
    if (step > this.limits.maxStepPct + 1e-9) {
      this.log('error', `Approval refused: ${usd(p.fromCents)} to ${usd(p.toCents)} is +${step.toFixed(1)}%, above the +${this.limits.maxStepPct}% step limit.`, p.id);
      return null;
    }
    // An approval binds to what the recommendation saw. If the account moved since, nothing is approved.
    const r = this.adapter.read(p.objectId);
    const observed = p.observedUpdatedMs ?? r.updatedMs;
    if (r.dailyBudget !== p.fromCents || r.updatedMs !== observed) {
      this.log('error', `Not approved: the recommendation saw ${usd(p.fromCents)}, the budget reads ${usd(r.dailyBudget)} now (last edited ${clockLabelSec(r.updatedMs)} by ${r.lastEditor}). It is recalculated from the current budget.`, p.id);
      return null;
    }
    const now = this.clock();
    const auth = {
      id: `AUTH-${String(++this.n).padStart(3, '0')}`,
      proposalId: p.id, objectId: p.objectId, objectName: p.objectName,
      fromCents: p.fromCents, toCents: p.toCents, observedUpdatedMs: observed,
      approver, approvedAt: now, expiresAt: now + this.limits.approvalTtlMs,
      conditions: authConditions(p, this.limits),
      status: 'approved',
    };
    this.auths.set(auth.id, auth);
    this.byProposal.set(key, auth);
    this.log('approval', `${auth.id} approved by ${approver}: ${p.objectName}, ${usd(p.fromCents)} to ${usd(p.toCents)}, valid until ${clockLabel(auth.expiresAt)}.`, auth.id);
    return auth;
  }

  execute(authId) {
    const a = this.auths.get(authId);
    if (!a) throw new Error(`Unknown authorization ${authId}`);
    const op = this.ops.get(authId);
    if (op?.status === 'executed') {
      this.log('action', `Run requested again for ${a.id}: it already ran at ${clockLabelSec(op.sentAt)}. No second request sent.`, a.id);
      return { outcome: 'already_executed', auth: a, op };
    }
    if (op?.status === 'unknown') {
      this.log('error', `${a.id} has a request whose result is unknown. Verify it first; nothing sent.`, a.id);
      return { outcome: 'needs_verification', auth: a };
    }
    if (this.stopped) {
      this.log('action', `Agent writes are stopped. Nothing sent for ${a.id}.`, a.id);
      return { outcome: 'stopped', auth: a };
    }
    if (['void', 'expired', 'refused', 'held'].includes(a.status)) {
      this.log('error', `${a.id} was already ${a.status === 'void' ? 'refused' : a.status}. Nothing sent; a new approval is required.`, a.id);
      return { outcome: 'already_closed', auth: a, previous: a.status };
    }
    const now = this.clock();
    if (now > a.expiresAt) {
      a.status = 'expired';
      this.log('error', `${a.id} expired at ${clockLabel(a.expiresAt)}. Nothing sent; a new approval is required.`, a.id);
      return { outcome: 'expired', auth: a };
    }
    const ds = this.dataStatus();
    const old = [];
    const incomplete = [];
    if (now - ds.metaReadMs > this.limits.maxDataAgeMs.meta) old.push(`Meta insights were last read at ${clockLabel(ds.metaReadMs)}, more than 6 hours ago`);
    if (now - ds.shopifyReadMs > this.limits.maxDataAgeMs.shopify) old.push(`Shopify orders were last read at ${clockLabel(ds.shopifyReadMs)}, more than 2 hours ago`);
    if (ds.daysComplete < ds.daysExpected) incomplete.push(`only ${ds.daysComplete} of ${ds.daysExpected} days are complete${ds.incompleteReason ? ` (${ds.incompleteReason})` : ''}`);
    if (old.length || incomplete.length) {
      a.status = 'held';
      this.log('error', `${a.id} held, nothing sent: ${[...old, ...incomplete].join('; ')}.`, a.id);
      return { outcome: 'held_data', auth: a, reasons: [...old, ...incomplete], tooOld: old.length > 0, incomplete: incomplete.length > 0 };
    }
    const blocking = this.unresolvedFor(a.objectId, a.id);
    if (blocking) {
      this.log('error', `Nothing sent for ${a.id}: ${blocking} on the same ad set has an unknown result. It must be verified first.`, a.id);
      return { outcome: 'blocked_unresolved', auth: a, blocking };
    }
    const before = this.adapter.read(a.objectId);
    if (before.dailyBudget !== a.fromCents || before.updatedMs !== a.observedUpdatedMs) {
      a.status = 'void';
      const same = before.dailyBudget === a.fromCents;
      this.log('error', same
        ? `Refused, nothing sent. The budget reads ${usd(before.dailyBudget)} again, but it was edited at ${clockLabelSec(before.updatedMs)} by ${before.lastEditor} after the recommendation. ${a.id} covered an account nobody had touched; it is void.`
        : `Refused, nothing sent. ${a.id} covered ${usd(a.fromCents)} to ${usd(a.toCents)}, but the budget reads ${usd(before.dailyBudget)} now (changed at ${clockLabelSec(before.updatedMs)} by ${before.lastEditor}). The approval no longer describes the account.`, a.id);
      return { outcome: 'refused_state_changed', auth: a, current: before.dailyBudget, editedSameValue: same };
    }
    if (a.toCents > a.fromCents) {
      const base = this.baseline(a.objectId);
      const cumPct = ((a.toCents - base) / base) * 100;
      if (cumPct > this.limits.maxDailyIncreasePct + 1e-9) {
        a.status = 'refused';
        this.log('error', `Refused, nothing sent. ${usd(a.toCents)} would be +${cumPct.toFixed(1)}% above this morning's ${usd(base)}; the internal limit is +${this.limits.maxDailyIncreasePct}% per day, all changes combined.`, a.id);
        return { outcome: 'refused_cumulative_cap', auth: a, cumPct };
      }
    }
    const req = prepareBudgetUpdate(a.objectId, a.toCents);
    const rec = { authId: a.id, status: 'sending', sentAt: now, request: req };
    this.ops.set(a.id, rec);
    this.log('action', `Sent POST ${req.url.replace('https://graph.facebook.com', '')} with daily_budget=${req.body.daily_budget} (cents) to the local simulator.`, a.id);
    try {
      this.adapter.updateBudget(a.objectId, a.toCents);
    } catch (e) {
      if (e.code !== 'RESPONSE_LOST') throw e;
      rec.status = 'unknown';
      a.status = 'unknown';
      this.log('error', `No response after sending ${a.id}. Result unknown: it will be verified by reading the budget before anything else is sent.`, a.id);
      return { outcome: 'unknown', auth: a };
    }
    return this.readBack(a, rec);
  }

  readBack(a, rec) {
    const after = this.adapter.read(a.objectId);
    rec.readback = after.dailyBudget;
    rec.readAt = this.clock();
    if (after.dailyBudget === a.toCents) {
      rec.status = 'executed';
      a.status = 'executed';
      this.log('result', `Executed. Read back after the change: daily_budget ${usd(after.dailyBudget)} at ${clockLabelSec(rec.readAt)}.`, a.id);
      return { outcome: 'executed', auth: a, readback: after.dailyBudget, readAt: rec.readAt };
    }
    rec.status = 'mismatch';
    a.status = 'void';
    this.log('error', `Read back ${usd(after.dailyBudget)} instead of ${usd(a.toCents)}. Flagged for a person; no retry.`, a.id);
    return { outcome: 'mismatch', auth: a, readback: after.dailyBudget };
  }

  // Reads are allowed even when writes are stopped.
  verify(authId) {
    const a = this.auths.get(authId);
    const rec = this.ops.get(authId);
    if (!rec || rec.status !== 'unknown') return { outcome: 'nothing_to_verify', auth: a };
    const r = this.adapter.read(a.objectId);
    const cur = r.dailyBudget;
    if (cur === a.toCents && r.updatedMs >= rec.sentAt) {
      rec.status = 'executed';
      a.status = 'executed';
      rec.readback = cur;
      rec.readAt = this.clock();
      this.log('result', `Verified ${a.id}: the request did apply, the budget reads ${usd(cur)}. Marked executed; no retry.`, a.id);
      return { outcome: 'executed', auth: a, readback: cur, readAt: rec.readAt };
    }
    if (cur === a.fromCents && r.updatedMs < rec.sentAt) {
      this.ops.delete(authId);
      a.status = 'approved';
      this.log('result', `Verified ${a.id}: nothing changed since before the request (budget ${usd(cur)}, last edited ${clockLabelSec(r.updatedMs)}). It did not apply and can be retried with the same absolute target, ${usd(a.toCents)}.`, a.id);
      return { outcome: 'not_applied', auth: a };
    }
    // A value back at the start does not prove the request failed: someone may have reverted it.
    rec.status = 'inconclusive';
    a.status = 'void';
    this.log('error', `Verified ${a.id}: the budget reads ${usd(cur)}, last edited ${clockLabelSec(r.updatedMs)} by ${r.lastEditor}, after the request was sent. Whether the request applied cannot be told. ${a.id} is void; nothing is retried without a new approval.`, a.id);
    return { outcome: 'inconclusive', auth: a, current: cur };
  }

  stop() {
    this.stopped = true;
    this.log('stop', 'Agent writes stopped. Reads continue. Your ads keep running exactly as they are.');
    for (const [id, rec] of this.ops) {
      if (rec.status === 'unknown') this.log('stop', `${id} was sent before the stop and its response was lost. It stays uncertain until verified.`, id);
    }
  }

  resume() {
    this.stopped = false;
    this.log('stop', 'Agent writes resumed.');
  }

  // Going back is a new change with its own approval, not an undo.
  revertProposal(authId) {
    const a = this.auths.get(authId);
    if (a?.status !== 'executed') return null;
    const r = this.adapter.read(a.objectId);
    return {
      id: `${a.proposalId}-back-${a.id}`, kind: 'decrease', verdict: 'decrease', objectId: a.objectId, objectName: a.objectName,
      fromCents: r.dailyBudget, toCents: a.fromCents, observedUpdatedMs: r.updatedMs,
      note: `Going back to ${usd(a.fromCents)} is a new change, not an undo: it needs its own approval, does not refund spend already made, and will be refused if someone edits the budget before it runs.`,
    };
  }
}
