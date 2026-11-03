// Decision rules. Thresholds are internal settings of the scenario, adjustable, and invented for it.
import { periodMetrics, adset } from './metrics.js';
import { DATA } from './syntheticData.js';
import { usd, pct } from './money.js';
import { clockLabel, dayLabel, localDate, datesBetween } from './time.js';

export const RULES = {
  stepPct: 10,
  minNewCustomers: 12,
  budgetLimitedShare: 0.9, // spend must reach 90% of 7 x budget, otherwise more budget changes nothing
  noEditHours: 72,
  fatigue: { minImpressions: 20000, freqUp: 0.25, ctrDown: 0.2, hookDown: 0.2, minPurchases: 30 },
};

const W = () => DATA.scenario.week;

export function evaluateScale(adsetId, { now, budgetRead, dataStatus, data = DATA }) {
  const a = adset(adsetId);
  const m = periodMetrics(adsetId, W().from, W().to, data);
  const target = data.scenario.targets.new_customer_cost_cents;
  const budget = budgetRead.dailyBudget;
  const hoursSinceEdit = (now - budgetRead.updatedMs) / 3600000;
  const calDays = datesBetween(localDate(budgetRead.updatedMs), localDate(now)).length - 1;
  const editedText = calDays === 0 ? 'today' : calDays === 1 ? 'yesterday' : `${calDays} days ago`;
  const c = [
    { id: 'complete', ok: m.days === m.daysExpected && dataStatus.daysComplete === dataStatus.daysExpected, text: `${Math.min(m.days, dataStatus.daysComplete)} of ${m.daysExpected} days complete for spend and orders (sync declared complete in the simulation)` },
    { id: 'fresh', ok: now - dataStatus.metaReadMs <= 6 * 3600e3 && now - dataStatus.shopifyReadMs <= 2 * 3600e3, text: `Meta read ${clockLabel(dataStatus.metaReadMs)}, Shopify read ${clockLabel(dataStatus.shopifyReadMs)}` },
    { id: 'new_customer_cost', ok: m.newCustomerCost != null && m.newCustomerCost <= target, text: `new-customer cost ${m.newCustomerCost == null ? 'unknown' : usd(m.newCustomerCost)} against the simulated ${usd(target, { whole: true })} new-customer target` },
    { id: 'volume', ok: m.shopify.newCustomers >= RULES.minNewCustomers, text: `${m.shopify.newCustomers} first orders among orders whose journey includes this ad set (minimum ${RULES.minNewCustomers})` },
    { id: 'budget_limited', ok: m.spend >= RULES.budgetLimitedShare * budget * 7, text: `budget almost fully used: ${usd(m.spend)} spent over the last 7 days, at least 90% of 7 \u00d7 ${usd(budget)}` },
    { id: 'no_recent_edit', ok: hoursSinceEdit >= RULES.noEditHours, text: `budget last edited ${editedText} (rule: not in the last ${RULES.noEditHours} hours)` },
  ];
  const verdict = c.every((x) => x.ok) ? 'increase' : 'hold';
  const toCents = Math.round((budget * (100 + RULES.stepPct)) / 100);
  return {
    id: `P-${adsetId}`, kind: verdict === 'increase' ? 'increase' : 'hold', verdict, adsetId,
    objectId: adsetId, objectName: a.name, fromCents: budget, toCents: verdict === 'increase' ? toCents : budget, observedUpdatedMs: budgetRead.updatedMs,
    conditions: c, metrics: m, target,
  };
}

export function evaluateFatigue(adsetId, data = DATA) {
  const p1 = periodMetrics(adsetId, '2026-10-20', '2026-10-26', data);
  const p2 = periodMetrics(adsetId, '2026-10-27', '2026-11-02', data);
  const others = data.adsets.filter((x) => x.id !== adsetId).map((x) => {
    const o1 = periodMetrics(x.id, '2026-10-20', '2026-10-26', data), o2 = periodMetrics(x.id, '2026-10-27', '2026-11-02', data);
    return { id: x.id, name: x.name, cpmChange: o2.cpm / o1.cpm - 1 };
  });
  const F = RULES.fatigue;
  const change = (a, b) => (a == null || b == null ? null : b / a - 1);
  const ev = {
    frequency: { p1: p1.frequency, p2: p2.frequency, change: change(p1.frequency, p2.frequency), num: [p1.impressions, p2.impressions], den: [p1.reach, p2.reach] },
    linkCtr: { p1: p1.linkCtr, p2: p2.linkCtr, change: change(p1.linkCtr, p2.linkCtr), num: [p1.linkClicks, p2.linkClicks], den: [p1.impressions, p2.impressions] },
    hookRate: { p1: p1.hookRate, p2: p2.hookRate, change: change(p1.hookRate, p2.hookRate), num: [p1.plays, p2.plays], den: [p1.impressions, p2.impressions] },
    costPerPurchase: { p1: p1.costPerMetaPurchase, p2: p2.costPerMetaPurchase, change: change(p1.costPerMetaPurchase, p2.costPerMetaPurchase), num: [p1.spend, p2.spend], den: [p1.meta.total.n, p2.meta.total.n] },
    cpm: { p1: p1.cpm, p2: p2.cpm, change: change(p1.cpm, p2.cpm) },
  };
  if (p1.impressions < F.minImpressions || p2.impressions < F.minImpressions) {
    return { verdict: 'insufficient_data', adsetId, p1, p2, ev, for: [], against: [`fewer than ${F.minImpressions.toLocaleString('en-US')} impressions in a period`], others };
  }
  const forList = [];
  if (ev.frequency.change >= F.freqUp) forList.push(`frequency ${ev.frequency.p1.toFixed(2)} to ${ev.frequency.p2.toFixed(2)} (up ${pct(ev.frequency.change, 0)})`);
  if (ev.linkCtr.change <= -F.ctrDown) forList.push(`link CTR ${pct(ev.linkCtr.p1, 2)} to ${pct(ev.linkCtr.p2, 2)} (down ${pct(-ev.linkCtr.change, 0)})`);
  if (ev.hookRate.change != null && ev.hookRate.change <= -F.hookDown) forList.push(`3-second hook rate ${pct(ev.hookRate.p1)} to ${pct(ev.hookRate.p2)} (down ${pct(-ev.hookRate.change, 0)})`);
  const against = [];
  const cppTarget = data.scenario.targets.cost_per_purchase_cents;
  if (ev.costPerPurchase.p2 <= cppTarget) against.push(`cost per Meta-reported purchase ${usd(ev.costPerPurchase.p2)}, still under the simulated ${usd(cppTarget, { whole: true })} cost-per-purchase target`);
  const auctionWide = others.every((o) => o.cpmChange > 0.02) && ev.cpm.change > 0.02;
  if (auctionWide) against.push(`CPM rose on every ad set (up ${pct(ev.cpm.change, 0)} here, ${others.map((o) => pct(o.cpmChange, 0)).join(' and ')} on the others), which points to auction pressure as one possible cause`);
  const launch = data.adsets.find((x) => x.id === adsetId).launch_date;
  if (launch && datesBetween(launch, p1.to).length <= 10) against.push(`the first period is the ad\u2019s first full week (it started ${dayLabel(launch)}) and may still have been in learning`);
  const purchaseLevel = p2.meta.total.n < F.minPurchases ? 'insufficient' : 'enough';
  if (purchaseLevel === 'insufficient') against.push(`${p1.meta.total.n} and ${p2.meta.total.n} purchases: too few to call fatigue on purchases alone`);
  const verdict = forList.length >= 2 ? 'suspected_review' : 'no_signal';
  return { verdict, adsetId, p1, p2, ev, for: forList, against, purchaseLevel, others };
}

export const periodLabel = (m) => `${dayLabel(m.from)} to ${dayLabel(m.to)}`;
