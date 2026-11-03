// Page controller. All decisions, numbers and journal lines come from the engine modules,
// the same files the test suite imports (copied by scripts/build.mjs).
import { DATA } from './engine/syntheticData.js';
import { createWorld } from './engine/world.js';
import { evaluateFatigue } from './engine/policy.js';
import { periodMetrics } from './engine/metrics.js';
import { reconcile, scene } from './engine/reconcile.js';
import { SCENARIOS } from './engine/scenarios.js';
import { validateNote } from './engine/notes.js';
import { AGENT_NOTES } from './engine/agentNotes.js';
import { prepareBudgetUpdate, prepareRead } from './engine/metaAdapter.js';
import { usd, pct } from './engine/money.js';
import { authConditions, absoluteNote } from './engine/executor.js';
import { clockLabel, clockLabelSec, dayLabel, localParts } from './engine/time.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = 'SIM-AS-101';
const START = Date.parse(DATA.scenario.now_utc);
const T0 = performance.now();
const clock = () => START + Math.round(performance.now() - T0);
const week = DATA.scenario.week;
const hhmm = (ms) => localParts(ms).time;

$('weekLabel').textContent = `${dayLabel(week.from)} to ${dayLabel(week.to)}`;

function note(el, key, verdict) {
  const n = AGENT_NOTES[key];
  const v = n && validateNote(n, verdict);
  if (!v?.ok) { el.hidden = true; return; }
  el.textContent = n.text;
}

/* ---------- hero: the decision you can test ---------- */
let world, current, auth, outcome, synced, mode = 'guided', edited = false;
const pageJournal = [];
const CLOSED = ['refused_state_changed', 'refused_cumulative_cap', 'already_closed', 'expired', 'held_data', 'inconclusive', 'mismatch'];

function syncJournal() {
  const j = world.executor.journal;
  for (; synced < j.length; synced++) pageJournal.push(j[synced]);
}
function addPersonLine(text, divider = false) { pageJournal.push({ at: clock(), kind: 'person', text, divider }); }

function newWorld(replay) {
  world = createWorld({ clock });
  current = world.propose(A);
  auth = null; outcome = null; synced = 0; edited = false;
  mode = replay ? 'replay' : 'guided';
  if (replay) addPersonLine('Replay: the simulator is back to this morning’s $100.00 and the same recommendation is made again. It needs a new approval.', true);
  world.executor.recommend(current);
  if ($('kill').checked) world.executor.stop();
  syncJournal();
}

function renderChecks() {
  const live = world.propose(A); // conditions as the simulator reads them now
  const ok = live.conditions.filter((c) => c.ok).length;
  $('whySum').textContent = `Conditions read now: ${ok} of ${live.conditions.length} met`;
  $('checks').innerHTML = live.conditions.map((c) => `<li class="${c.ok ? '' : 'fail'}">${esc(c.text[0].toUpperCase() + c.text.slice(1))}</li>`).join('');
}

function tagState() {
  if (current.verdict === 'hold') return 'hold';
  if (!outcome) return auth ? 'approved' : 'proposed';
  return ({ refused_state_changed: 'refused', refused_cumulative_cap: 'refused', already_closed: 'refused', expired: 'expired', executed: 'executed', already_executed: 'executed', unknown: 'unknown', needs_verification: 'unknown', blocked_unresolved: 'unknown', inconclusive: 'refused', stopped: 'stopped', held_data: 'held', superseded: 'superseded', mismatch: 'refused' }[outcome.outcome] ?? 'approved');
}

function nextAction(state) {
  if (state === 'hold' || ['refused', 'expired', 'held', 'superseded'].includes(state)) return 'btnReplay';
  if (state === 'stopped') return null;
  if (state === 'executed') return null;
  if (!auth) return 'btnApprove';
  if (mode === 'guided' && !edited) return 'btnEdit';
  return 'btnRun';
}

function renderTag() {
  const state = tagState();
  $('tag').dataset.state = state;
  $('tagObj').textContent = current.objectName;
  $('tagFrom').textContent = usd(current.fromCents);
  $('tagTo').textContent = usd(current.toCents);
  $('tagId').textContent = state === 'hold' ? 'No change recommended now'
    : auth ? `Authorization ${auth.id}` : (current.kind === 'decrease' ? 'A new change, waiting for your approval' : 'Recommendation, waiting for your approval');
  if (state === 'hold') {
    const failing = current.conditions.filter((c) => !c.ok).map((c) => c.text);
    $('tagCond').innerHTML = `<li><b>Held because</b> ${esc(failing.join('; '))}.</li>`;
  } else {
    const conds = auth ? auth.conditions : authConditions(current);
    $('tagCond').innerHTML = `<li><b>Runs only if</b> ${esc(conds.join(', '))}.</li><li><b>${auth ? 'Valid until ' + clockLabel(auth.expiresAt) : 'Valid 30 minutes once approved'}.</b> ${esc(absoluteNote(current))}</li>`;
  }
  $('tagSign').textContent = auth ? `Approved by you, ${clockLabelSec(auth.approvedAt)}` : state === 'hold' ? 'Nothing to approve' : 'Not approved yet';
  const o = outcome;
  const op = auth && world.executor.ops.get(auth.id);
  const msgs = {
    hold: () => 'The budget was edited today, so the rules hold. Replay to try the path that succeeds.',
    refused: () => o.outcome === 'refused_cumulative_cap' ? 'Refused: above today\u2019s +20% limit. Nothing sent.'
      : o.outcome === 'already_closed' ? 'Already refused. Nothing sent.'
      : o.outcome === 'inconclusive' ? 'Result cannot be told. Void; nothing retried.'
      : o.editedSameValue ? 'Refused. The budget was edited after the recommendation; nothing sent.'
      : `Refused. The budget reads ${usd(o.current)} now; nothing sent.`,
    expired: () => 'Expired. Nothing sent; approve again.',
    executed: () => `Executed. Read back ${usd(op.readback)} at ${clockLabelSec(op.readAt)}.`,
    unknown: () => o.outcome === 'blocked_unresolved' ? 'Blocked: an earlier request is unresolved.' : 'Result unknown. Verifying before anything else.',
    stopped: () => 'Stopped. Nothing sent.',
    held: () => o.tooOld ? 'Held: data too old. Nothing sent.' : 'Held: data incomplete. Nothing sent.',
    superseded: () => `Executed earlier, then set to ${usd(world.sim.objects[A].daily_budget_cents)} by a person.`,
  };
  const msg = msgs[state] ? msgs[state]() : '';
  $('stamp').hidden = !msg;
  $('stamp').textContent = msg;
  $('btnApprove').textContent = `Approve ${usd(current.fromCents, { whole: true })} to ${usd(current.toCents, { whole: true })}`;
  $('btnBack').hidden = !(state === 'executed' && current.kind !== 'decrease');
  $('stepEdit').hidden = mode === 'replay';
  $('replayNote').hidden = mode !== 'replay';
  const next = nextAction(state);
  for (const id of ['btnApprove', 'btnEdit', 'btnRun', 'btnReplay', 'btnBack']) $(id).classList.toggle('primary', id === next);
  $('btnReplay').classList.toggle('quiet', next !== 'btnReplay');
}

function renderJournal() {
  const ol = $('journal');
  for (let i = ol.children.length; i < pageJournal.length; i++) {
    const e = pageJournal[i];
    const li = document.createElement('li');
    li.className = 'new';
    const kindLabel = { recommendation: 'recommendation', approval: 'approval', action: 'action', result: 'result', error: 'refusal or error', stop: 'stop switch', person: e.divider ? 'replay' : 'person (simulated)' }[e.kind];
    li.innerHTML = `<time>${hhmm(e.at)}</time><div><span class="k k-${e.kind}">${kindLabel}</span>${esc(e.text)}</div>`;
    ol.appendChild(li);
  }
  ol.scrollTop = ol.scrollHeight;
}

function renderSim() {
  const o = world.sim.objects[A];
  $('simNow').innerHTML = `Simulator now: <b>daily_budget ${o.daily_budget_cents}</b> (${usd(o.daily_budget_cents)}), last changed by ${esc(o.last_editor)} ${localParts(o.updated_ms).date === localParts(clock()).date ? 'at ' + clockLabelSec(o.updated_ms) : 'on ' + dayLabel(localParts(o.updated_ms).date)}.`;
  const post = prepareBudgetUpdate(current.objectId, current.toCents);
  const get = prepareRead(current.objectId);
  $('reqPre').textContent = `1. Re-read before sending\nGET ${get.url}?fields=${get.query.fields}\n\n2. Only if it still reads ${current.fromCents}, unedited since the recommendation\nPOST ${post.url}\n${JSON.stringify(post.body)}\n\n3. Read back and compare with ${current.toCents}`;
}

function render() { syncJournal(); renderTag(); renderChecks(); renderJournal(); renderSim(); }

$('btnApprove').addEventListener('click', () => {
  if (current.verdict === 'hold') { addPersonLine('Nothing to approve: no change is recommended now.'); render(); return; }
  const a = world.executor.approve(current);
  if (a) {
    if (!auth || a.id !== auth.id) outcome = null;
    auth = a;
  } else {
    // The account moved since the recommendation: recalculate from the current budget.
    current = world.propose(A);
    auth = null; outcome = null;
    if (current.verdict === 'increase') world.executor.recommend(current);
  }
  render();
});
$('btnEdit').addEventListener('click', () => {
  world.sim.humanEdit(A, 13000);
  edited = true;
  addPersonLine('Daily budget set to $130.00 in Ads Manager (simulated). The agent was not involved.');
  if (outcome && ['executed', 'already_executed'].includes(outcome.outcome)) outcome = { outcome: 'superseded' };
  render();
});
$('btnRun').addEventListener('click', () => {
  if (!auth) { addPersonLine('Run pressed with nothing approved: the executor has nothing to send.'); render(); return; }
  outcome = world.executor.execute(auth.id);
  if (outcome.outcome === 'unknown') outcome = { ...outcome, ...world.executor.verify(auth.id) };
  render();
});
$('btnReplay').addEventListener('click', () => { newWorld(true); render(); });
$('btnBack').addEventListener('click', () => {
  current = world.executor.revertProposal(auth.id);
  world.executor.recommend(current);
  world.executor.log('recommendation', current.note, current.id);
  auth = null; outcome = null;
  render();
});
$('kill').addEventListener('change', (e) => {
  if (e.target.checked) world.executor.stop();
  else { world.executor.resume(); if (outcome?.outcome === 'stopped') outcome = null; }
  render();
});

if (matchMedia('(max-width: 760px)').matches) $('why').open = false;
newWorld(false);
render();
note($('note101'), 'P-SIM-AS-101', current.verdict);

/* ---------- the other two calls ---------- */
const hold = createWorld().propose('SIM-AS-102');
const hm = hold.metrics;
$('holdTitle').textContent = `${hold.objectName}: stays at ${usd(hold.fromCents)} a day`;
$('holdFacts').innerHTML = [
  ['Meta-reported ROAS', `<b>${hm.roasMeta.toFixed(2)}</b> on ${usd(hm.spend)} spent (7-day link click, 1-day engage-through, 1-day view)`],
  ['Orders whose journey includes this ad set', `<b>${hm.shopify.linked}</b>, of which ${hm.shopify.returning} from returning customers (${pct(hm.shopify.returningShare, 0)})`],
  ['New-customer cost', `<b>${usd(hm.newCustomerCost)}</b> for ${hm.shopify.newCustomers} first orders, against the simulated ${usd(hold.target, { whole: true })} new-customer target`],
  ['Offer', `${hm.shopify.discountedOrders} of ${hm.shopify.linked} orders used the BOGO offer, ${usd(hm.shopify.avgDiscount)} given away per order on average`],
].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + `<dt>Definition</dt><dd>A new customer is a first order in the store's known history (Shopify <code>customerOrderIndex</code> = 1), not someone absent from this week. All figures simulated.</dd>`;
note($('note102'), 'P-SIM-AS-102', hold.verdict);

const f = evaluateFatigue('SIM-AS-103');
const n = (x) => x.toLocaleString('en-US');
const ch = (c) => (c == null ? '' : `${c > 0 ? 'up' : 'down'} ${pct(Math.abs(c), 0)}`);
$('fatigueTable').innerHTML = `<thead><tr><th>Simulated</th><th>${dayLabel(f.p1.from)} to ${dayLabel(f.p1.to)}</th><th>${dayLabel(f.p2.from)} to ${dayLabel(f.p2.to)}</th><th>Change</th></tr></thead><tbody>` + [
  ['Frequency', f.ev.frequency.p1.toFixed(2), f.ev.frequency.p2.toFixed(2), `${n(f.p1.impressions)} / ${n(f.p1.reach)} reached`, `${n(f.p2.impressions)} / ${n(f.p2.reach)} reached`, f.ev.frequency.change],
  ['Link CTR', pct(f.ev.linkCtr.p1, 2), pct(f.ev.linkCtr.p2, 2), `${n(f.p1.linkClicks)} link clicks / ${n(f.p1.impressions)}`, `${n(f.p2.linkClicks)} / ${n(f.p2.impressions)}`, f.ev.linkCtr.change],
  ['3-second hook rate', pct(f.ev.hookRate.p1), pct(f.ev.hookRate.p2), `${n(f.p1.plays)} plays / ${n(f.p1.impressions)}`, `${n(f.p2.plays)} / ${n(f.p2.impressions)}`, f.ev.hookRate.change],
  ['Cost per Meta purchase', usd(f.ev.costPerPurchase.p1), usd(f.ev.costPerPurchase.p2), `${usd(f.p1.spend)} / ${f.p1.meta.total.n}`, `${usd(f.p2.spend)} / ${f.p2.meta.total.n}`, f.ev.costPerPurchase.change],
  ['CPM', usd(f.ev.cpm.p1), usd(f.ev.cpm.p2), '', '', f.ev.cpm.change],
].map(([k, a, b, fa, fb, c]) => `<tr><td>${k}</td><td>${a}<span class="frac">${fa}</span></td><td>${b}<span class="frac">${fb}</span></td><td>${ch(c)}</td></tr>`).join('') + '</tbody>';
const cap = (s) => s[0].toUpperCase() + s.slice(1);
$('fatFor').innerHTML = f.for.map((x) => `<li>${esc(cap(x))}</li>`).join('');
$('fatAgainst').innerHTML = f.against.map((x) => `<li>${esc(cap(x))}</li>`).join('');
note($('note103'), 'fatigue-SIM-AS-103', f.verdict);

/* ---------- reconciliation ---------- */
const r = reconcile();
const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="n">${v}</td></tr>`;
$('readings').innerHTML =
  `<tr class="head"><th colspan="2">Meta, purchases it attributes <small>read ${clockLabel(r.meta.readAt)}</small></th></tr>` +
  row(`7-day link click, ${r.meta.click.n} purchases`, usd(r.meta.click.value)) +
  row(`1-day engage-through, ${r.meta.engage.n}`, usd(r.meta.engage.value)) +
  row(`1-day view, ${r.meta.view.n}`, usd(r.meta.view.value)) +
  row('Total, dated on the impression', usd(r.meta.total.value), 'total') +
  `<tr class="head"><th colspan="2">Shopify, orders created this week <small>read ${clockLabel(r.shopify.readAt)}</small></th></tr>` +
  row(`${r.shopify.orders} orders, gross sales`, usd(r.shopify.gross)) +
  row('Discounts', `−${usd(r.shopify.discounts)}`) +
  row(`Returns processed this week (${r.shopify.returnsCount})`, `−${usd(r.shopify.returns)}`) +
  row('Net sales', usd(r.shopify.netSales), 'total') +
  row('Taxes and shipping, kept apart', `${usd(r.shopify.taxes)} and ${usd(r.shopify.shipping)}`, 'sub') +
  `<tr class="head"><th colspan="2">Shopify, sales it credits to Meta <small>read ${clockLabel(r.shopifyMeta.readAt)}</small></th></tr>` +
  row(`Last non-direct click from a Meta UTM, ${r.shopifyMeta.n} orders`, usd(r.shopifyMeta.value), 'total') +
  row(esc(r.shopifyMeta.note[0].toUpperCase() + r.shopifyMeta.note.slice(1)), '', 'sub');
const maxAbs = Math.max(...r.lines.map((l) => Math.abs(l.value)));
$('gap').innerHTML = `<h4>Meta total minus what Shopify credits to Meta</h4><p class="big">${usd(r.gap)}</p>` + r.lines.map((l) => {
  const w = (Math.abs(l.value) / maxAbs) * 100;
  return `<div class="bar ${l.value < 0 ? 'neg' : ''} ${l.status === 'unexplained' ? 'unexplained' : ''}"><div>${esc(l.text)}<small>${l.status === 'unexplained' ? 'Left after the lines above; stays open' : l.status === 'assumed' ? 'Assumed in this scenario; size from: ' + esc(l.source) : 'Explained by: ' + esc(l.source)}</small></div><div class="v">${l.value < 0 ? '−' : ''}${usd(Math.abs(l.value))}</div><div class="track"><div class="fill" style="left:0;width:${w.toFixed(1)}%"></div></div></div>`;
}).join('');

const s = scene();
const when = (iso) => { const ms = Date.parse(iso); return `${dayLabel(localParts(ms).date)}, ${clockLabel(ms).replace(' ET', '')}`; };
const items = s.order.lines.map((l) => l.title.replace(' Bracelet/Necklace', '')).join(' and ');
$('timeline').innerHTML = [
  [s.click_utc, `Customer ${s.customer_id} clicks the Crystal Cross ad.`, 'Meta will date the purchase here, on the impression.'],
  [s.email_click_utc, 'She comes back from an email.', 'Shopify’s last click: email.'],
  [s.order_utc, `Orders the ${items}, ${usd(s.value)} before tax.`, `Meta: ${usd(s.value)} under 7-day link click. Shopify: ${usd(s.value)} credited to email.`],
  [s.ret.processed_utc, `Return of the wrap processed, ${usd(s.ret.amount_cents)}.`, `Shopify: −${usd(s.ret.amount_cents)} on the day it is processed. Meta: unchanged.`],
].map(([t, what, counts]) => `<li><time>${when(t)}</time>${esc(what)}<div class="counts">${esc(counts)}</div></li>`).join('');

/* ---------- lab ---------- */
$('cases').innerHTML = SCENARIOS.map((sc) => `<li class="case" id="case-${sc.id}"><div class="what"><h3>${esc(sc.title)}</h3><p class="exp">${esc(sc.expect)}</p></div><button class="btn quiet run" type="button" data-id="${sc.id}">Run it</button><div class="out" aria-live="polite"></div></li>`).join('');
$('cases').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const sc = SCENARIOS.find((x) => x.id === b.dataset.id);
  const res = sc.run();
  const out = b.closest('.case').querySelector('.out');
  out.innerHTML = `<span class="chip good">Ran: ${res.writes} request${res.writes === 1 ? '' : 's'} reached the simulator; budget now ${usd(res.budget)}</span><ol>${res.journal.map((j) => `<li><time>${hhmm(j.at).slice(0, 5)}</time><span>${esc(j.text)}</span></li>`).join('')}</ol>`;
  b.textContent = 'Run again';
});
