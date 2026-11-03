// Generates the SYNTHETIC week used by the demo (seeded, deterministic).
// Nothing here is Katia Designs' data: spend, impressions, orders, customers and the account
// structure are invented. Real public facts live in engine/publicSnapshot.js.
import { writeFileSync } from 'node:fs';
import { datesBetween, localToUtc, hoursInLocalDay, nextDate } from '../engine/time.js';

let seed = 20261103;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const iso = (ms) => new Date(ms).toISOString();

const DAYS = datesBetween('2026-10-20', '2026-11-02');
const WEEK = datesBetween('2026-10-27', '2026-11-02');

// Real catalog prices (katiadesigns.com, collected Nov 3, 2026); used only to price synthetic orders.
const CROSS = { title: 'Crystal Cross Chunky Chain Necklace', price: 12400 };
const WRAPS = [
  { title: 'I Am Safe Heart Wood Boho Wrap Bracelet/Necklace', price: 6900 },
  { title: 'Grateful Thankful Blessed Heart Wood Boho Wrap Bracelet/Necklace', price: 6900 },
  { title: 'All is Well Heart Crystal Boho Wrap Bracelet/Necklace', price: 7900 },
  { title: 'Howlite Wrap Bracelet/Necklace', price: 6900 },
  { title: 'I Welcome Miracles Into My Life Crystal Boho Wrap Necklace/Bracelet', price: 7900 },
];
const REMEMBER = { title: 'Remember Who The F*ck You Are Crystal Boho Wrap Necklace/Bracelet', price: 7900 };

const ADSETS = [
  { id: 'SIM-AS-101', name: 'Crystal Cross, prospecting', campaign_id: 'SIM-C-10', campaign_name: 'Prospecting (simulated)', library_id: '2054044151911791', daily_budget_cents: 10000,
    cpm: 2400, ctr: [0.0162, 0.0158], cvr: 0.052, newShare: 0.76, spendF: () => between(0.93, 1.06), basket: () => [CROSS] },
  { id: 'SIM-AS-102', name: 'BOGO Boho Wraps, broad', campaign_id: 'SIM-C-11', campaign_name: 'Offers (simulated)', library_id: '941661894938227', daily_budget_cents: 15000,
    cpm: 1900, ctr: [0.0192, 0.0186], cvr: 0.040, newShare: 0.32, spendF: () => between(0.94, 1.04), basket: () => { const a = pick(WRAPS), b = pick(WRAPS); return [a, b]; }, bogo: true },
  { id: 'SIM-AS-103', name: 'Inner Light video', campaign_id: 'SIM-C-10', campaign_name: 'Prospecting (simulated)', library_id: '1655236699580259', daily_budget_cents: 8000,
    cpm: 2050, ctr: [0.0148, 0.0084], cvr: 0.050, newShare: 0.52, spendF: () => between(0.95, 1.03), basket: () => [REMEMBER], hook: [0.335, 0.205] },
];

const daily = [];
const orders = [];
const metaExtra = []; // conversions Meta reports that Shopify credits to another channel (engage-through, view)
let orderNo = 41000, cust = 300;

function makeOrder({ adset, clickMs, orderMs, lastSource, isNew, lines, bogo }) {
  const gross = lines.reduce((s, l) => s + l.price, 0);
  const discount = bogo ? Math.min(...lines.map((l) => l.price)) : 0;
  const net = gross - discount;
  const o = {
    id: `SIM-#${++orderNo}`, customer_id: `SIM-C-${String(++cust).padStart(4, '0')}`,
    created_utc: iso(orderMs), customerOrderIndex: isNew ? 1 : 2 + Math.floor(rnd() * 5),
    lines: lines.map((l) => ({ title: l.title, price_cents: l.price, qty: 1 })),
    discount_cents: discount, discount_code: bogo ? 'BOGO (simulated)' : null,
    tax_cents: Math.round(net * 0.07), shipping_cents: net >= 9900 ? 0 : 795,
    journey: { first: { source: 'meta', utm_content: adset.id, at: iso(clickMs) }, last: { source: lastSource, utm_content: lastSource === 'meta' ? adset.id : null, at: iso(orderMs - 7 * 60000) } },
    meta_click: { adset_id: adset.id, at: iso(clickMs) },
  };
  orders.push(o);
  return o;
}

// Meta: spending in a calendar week (ending Saturday at midnight) never exceeds 7 x the daily budget.
// Each week's spend is scaled under that cap, keeping the one deliberate day above budget.
const weekStart = (d) => { const t = Date.parse(d + 'T12:00:00Z'); return new Date(t - new Date(t).getUTCDay() * 86400000).toISOString().slice(0, 10); };
const spendPlan = {};
for (const a of ADSETS) {
  const f = DAYS.map((d) => (a.id === 'SIM-AS-101' && d === '2026-10-31' ? 1.38 : a.spendF()));
  const groups = {};
  DAYS.forEach((d, i) => { (groups[weekStart(d)] ??= []).push(i); });
  for (const idx of Object.values(groups)) {
    const cap = 7 * 0.985;
    const sum = idx.reduce((s, i) => s + f[i], 0);
    if (sum <= cap) continue;
    const fixed = idx.filter((i) => f[i] > 1.3);
    const free = idx.filter((i) => f[i] <= 1.3);
    const fixedSum = fixed.reduce((s, i) => s + f[i], 0);
    const freeSum = free.reduce((s, i) => s + f[i], 0);
    for (const i of free) f[i] *= (cap - fixedSum) / freeSum;
  }
  spendPlan[a.id] = f;
}

for (const a of ADSETS) {
  DAYS.forEach((d, i) => {
    const t = i / (DAYS.length - 1);
    const lateCpm = d >= '2026-11-01' ? 1.18 : 1;
    const f = spendPlan[a.id][i]; // Oct 31 on SIM-AS-101: above budget, inside Meta's 75% daily flexibility
    const spend = Math.floor(a.daily_budget_cents * f);
    const cpm = a.cpm * lateCpm * between(0.97, 1.03);
    const impressions = Math.round((spend / cpm) * 1000);
    const ctr = a.ctr[0] + (a.ctr[1] - a.ctr[0]) * t;
    const linkClicks = Math.round(impressions * ctr * between(0.95, 1.05));
    const row = { date: d, adset_id: a.id, spend_cents: spend, impressions, link_clicks: linkClicks };
    if (a.hook) row.video_3s_plays = Math.round(impressions * (a.hook[0] + (a.hook[1] - a.hook[0]) * t));
    daily.push(row);
    // Orders that start from a Meta link click on day d.
    const n = Math.round(linkClicks * a.cvr * between(0.85, 1.15));
    for (let k = 0; k < n; k++) {
      const clickMs = localToUtc(d, 8 + Math.floor(rnd() * 14), Math.floor(rnd() * 60));
      const lagMs = rnd() < 0.8 ? between(5, 90) * 60000 : between(20, 120) * 3600000;
      makeOrder({ adset: a, clickMs, orderMs: clickMs + lagMs, lastSource: rnd() < 0.8 ? 'meta' : pick(['email', 'direct']), isNew: rnd() < a.newShare, lines: a.basket(), bogo: a.bogo });
    }
    // Engage-through and 1-day view conversions Meta will report for this ad set.
    const ne = Math.round(n * (a.bogo ? 0.32 : 0.18) * between(0.8, 1.2));
    for (let k = 0; k < ne; k++) {
      const touch = localToUtc(d, 9 + Math.floor(rnd() * 12), Math.floor(rnd() * 60));
      const lines = a.basket();
      const gross = lines.reduce((s, l) => s + l.price, 0) - (a.bogo ? Math.min(...lines.map((l) => l.price)) : 0);
      const o = {
        id: `SIM-#${++orderNo}`, customer_id: `SIM-C-${String(++cust).padStart(4, '0')}`, created_utc: iso(touch + between(1, 20) * 3600000),
        customerOrderIndex: rnd() < a.newShare * 0.6 ? 1 : 3, lines: lines.map((l) => ({ title: l.title, price_cents: l.price, qty: 1 })),
        discount_cents: a.bogo ? Math.min(...lines.map((l) => l.price)) : 0, discount_code: a.bogo ? 'BOGO (simulated)' : null,
        tax_cents: Math.round(gross * 0.07), shipping_cents: gross >= 9900 ? 0 : 795,
        journey: { first: { source: pick(['organic', 'email', 'direct']), utm_content: null, at: iso(touch + 3600000) }, last: { source: pick(['organic', 'email', 'direct']), utm_content: null, at: iso(touch + 3600000) } },
        meta_click: null,
      };
      orders.push(o);
      metaExtra.push({ adset_id: a.id, type: rnd() < 0.6 ? 'engage_through_1d' : 'view_1d', touch_utc: iso(touch), order_id: o.id, value_cents: gross });
    }
  });
}

// The scene: one synthetic customer, four events.
const sceneClick = localToUtc('2026-10-28', 21, 40);
const sceneOrder = localToUtc('2026-10-30', 12, 22);
const scene = makeOrder({ adset: ADSETS[0], clickMs: sceneClick, orderMs: sceneOrder, lastSource: 'email', isNew: true, lines: [CROSS, WRAPS[0]] });
scene.customer_id = 'SIM-C-0417';
scene.journey.last.at = iso(localToUtc('2026-10-30', 12, 15));

const returns = [
  { order_id: scene.id, line: WRAPS[0].title, amount_cents: WRAPS[0].price, processed_utc: iso(localToUtc('2026-11-02', 10, 5)) },
];
// Two more returns processed during the week, on earlier orders.
const early = orders.filter((o) => o.created_utc < iso(localToUtc('2026-10-27', 0, 0)) && o.meta_click);
for (const o of early.slice(3, 5)) returns.push({ order_id: o.id, line: o.lines[0].title, amount_cents: o.lines[0].price_cents, processed_utc: iso(localToUtc(pick(WEEK.slice(1, 6)), 11, 30)) });

// Purchases Meta reports that match no Shopify order (e.g. a duplicated browser + server event).
const unmatched = [
  { adset_id: 'SIM-AS-102', type: 'click_7d', touch_utc: iso(localToUtc('2026-10-29', 19, 10)), value_cents: 8400 },
  { adset_id: 'SIM-AS-101', type: 'click_7d', touch_utc: iso(localToUtc('2026-11-01', 14, 50)), value_cents: 12400 },
];

// Hourly spend for the week for one ad set, stamped in UTC, to test local-day bucketing (Nov 1 has 25 hours in New York).
const hourly = [];
for (const d of WEEK) {
  const row = daily.find((r) => r.date === d && r.adset_id === 'SIM-AS-101');
  const hours = hoursInLocalDay(d);
  const start = localToUtc(d, 0, 0);
  let left = row.spend_cents;
  for (let h = 0; h < hours; h++) {
    const c = h === hours - 1 ? left : Math.floor(row.spend_cents / hours);
    left -= c;
    hourly.push({ ts_utc: iso(start + h * 3600000), spend_cents: c });
  }
}

// Reach per comparison period (reach does not add up across days, so it is read per period).
const reach = {
  'SIM-AS-103': { '2026-10-20..2026-10-26': 0.592, '2026-10-27..2026-11-02': 0.421 },
  'SIM-AS-101': { '2026-10-20..2026-10-26': 0.77, '2026-10-27..2026-11-02': 0.74 },
  'SIM-AS-102': { '2026-10-20..2026-10-26': 0.70, '2026-10-27..2026-11-02': 0.68 },
};
const reachRows = [];
for (const [id, periods] of Object.entries(reach)) {
  for (const [p, ratio] of Object.entries(periods)) {
    const [from, to] = p.split('..');
    const imp = daily.filter((r) => r.adset_id === id && r.date >= from && r.date <= to).reduce((s, r) => s + r.impressions, 0);
    reachRows.push({ adset_id: id, from, to, reach: Math.round(imp * ratio) });
  }
}

// Nothing can be known after the scenario's "now" (Nov 3, 07:50 New York).
const NOW = localToUtc('2026-11-03', 7, 50);
const known = orders.filter((o) => Date.parse(o.created_utc) <= NOW);
const knownIds = new Set(known.map((o) => o.id));
const extraKnown = metaExtra.filter((x) => knownIds.has(x.order_id));

const DATA = {
  _notice: 'SYNTHETIC. Generated by scripts/generate-data.mjs (seed 20261103). Not Katia Designs data.',
  account: { time_zone: 'America/New_York', currency: 'USD', budget_sharing: false },
  scenario: {
    now_utc: iso(localToUtc('2026-11-03', 7, 50)),
    reads: { meta_insights_utc: iso(localToUtc('2026-11-03', 7, 42)), shopify_orders_utc: iso(localToUtc('2026-11-03', 7, 45)), shopify_attribution_utc: iso(localToUtc('2026-11-03', 7, 45)) },
    week: { from: WEEK[0], to: WEEK[WEEK.length - 1] },
    attribution_setting: { click: '7-day link click', engage_through: '1-day engage-through', view: '1-day view', action_report_time: 'impression' },
    sync: { meta: { complete_through: '2026-11-02', note: 'declared complete in the simulation' }, shopify: { complete_through: '2026-11-02', note: 'declared complete in the simulation' } },
    targets: { new_customer_cost_cents: 5500, cost_per_purchase_cents: 5000 },
  },
  adsets: ADSETS.map(({ id, name, campaign_id, campaign_name, library_id, daily_budget_cents }) => ({
    id, name, campaign_id, campaign_name, library_id, daily_budget_cents, budget_level: 'ad set', effective_status: 'ACTIVE',
    launch_date: { '2054044151911791': '2026-10-14', '941661894938227': '2026-08-26', '1655236699580259': '2026-10-18' }[library_id], // public Ad Library start dates
    updated_utc: iso(localToUtc('2026-10-24', 10, 0)),
  })),
  daily, reach: reachRows, orders: known, returns, meta_extra: extraKnown, meta_unmatched: unmatched, hourly_spend: { adset_id: 'SIM-AS-101', rows: hourly },
  scene: { order_id: scene.id, customer_id: 'SIM-C-0417', click_utc: iso(sceneClick), email_click_utc: scene.journey.last.at, order_utc: scene.created_utc, return_utc: returns[0].processed_utc },
};
writeFileSync(new URL('../engine/syntheticData.js', import.meta.url), `// GENERATED by scripts/generate-data.mjs. SYNTHETIC data, not Katia Designs data.\nexport const DATA = ${JSON.stringify(DATA)};\n`);
console.log(`orders ${known.length}, daily rows ${daily.length}, hourly rows ${hourly.length}`);
