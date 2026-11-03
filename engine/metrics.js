// Metrics computed from the synthetic dataset. Every number on the page comes from here.
import { DATA } from './syntheticData.js';
import { localDate, datesBetween } from './time.js';

const inRange = (d, from, to) => d >= from && d <= to;
const orderNet = (o) => o.lines.reduce((s, l) => s + l.price_cents * l.qty, 0) - o.discount_cents;

export const adset = (id) => DATA.adsets.find((a) => a.id === id);

export function periodMetrics(adsetId, from, to, data = DATA) {
  const rows = data.daily.filter((r) => r.adset_id === adsetId && inRange(r.date, from, to));
  const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  const spend = sum('spend_cents');
  const impressions = sum('impressions');
  const linkClicks = sum('link_clicks');
  const plays = rows.some((r) => r.video_3s_plays != null) ? sum('video_3s_plays') : null;
  const reachRow = data.reach.find((x) => x.adset_id === adsetId && x.from === from && x.to === to);

  // Meta-reported purchases, dated on the impression (action_report_time = impression).
  const clickOrders = data.orders.filter((o) => o.meta_click?.adset_id === adsetId && inRange(localDate(Date.parse(o.meta_click.at)), from, to));
  const unmatched = data.meta_unmatched.filter((u) => u.adset_id === adsetId && inRange(localDate(Date.parse(u.touch_utc)), from, to));
  const extra = data.meta_extra.filter((x) => x.adset_id === adsetId && inRange(localDate(Date.parse(x.touch_utc)), from, to));
  const meta = {
    click: { n: clickOrders.length + unmatched.length, value: clickOrders.reduce((s, o) => s + orderNet(o), 0) + unmatched.reduce((s, u) => s + u.value_cents, 0) },
    engage: { n: extra.filter((x) => x.type === 'engage_through_1d').length, value: extra.filter((x) => x.type === 'engage_through_1d').reduce((s, x) => s + x.value_cents, 0) },
    view: { n: extra.filter((x) => x.type === 'view_1d').length, value: extra.filter((x) => x.type === 'view_1d').reduce((s, x) => s + x.value_cents, 0) },
  };
  meta.total = { n: meta.click.n + meta.engage.n + meta.view.n, value: meta.click.value + meta.engage.value + meta.view.value };

  // Shopify orders whose journey includes a link click from this ad set, dated on the order.
  const linked = data.orders.filter((o) => (o.journey.first.utm_content === adsetId || o.journey.last.utm_content === adsetId) && inRange(localDate(Date.parse(o.created_utc)), from, to));
  const newOrders = linked.filter((o) => o.customerOrderIndex === 1);
  const discounted = linked.filter((o) => o.discount_cents > 0);

  return {
    adsetId, from, to,
    days: rows.length, daysExpected: datesBetween(from, to).length,
    spend, impressions, linkClicks,
    linkCtr: impressions ? linkClicks / impressions : null,
    cpm: impressions ? (spend / impressions) * 1000 : null,
    plays, hookRate: plays != null && impressions ? plays / impressions : null,
    reach: reachRow?.reach ?? null, frequency: reachRow ? impressions / reachRow.reach : null,
    meta, roasMeta: spend ? meta.total.value / spend : null,
    costPerMetaPurchase: meta.total.n ? spend / meta.total.n : null,
    shopify: {
      linked: linked.length, newCustomers: newOrders.length, returning: linked.length - newOrders.length,
      returningShare: linked.length ? (linked.length - newOrders.length) / linked.length : null,
      discountedOrders: discounted.length,
      avgDiscount: discounted.length ? discounted.reduce((s, o) => s + o.discount_cents, 0) / discounted.length : 0,
    },
    newCustomerCost: newOrders.length ? spend / newOrders.length : null,
    dailySpend: rows.map((r) => ({ date: r.date, spend: r.spend_cents })),
  };
}

export function dataStatusFromScenario(data = DATA) {
  return {
    metaReadMs: Date.parse(data.scenario.reads.meta_insights_utc),
    shopifyReadMs: Date.parse(data.scenario.reads.shopify_orders_utc),
    daysComplete: datesBetween(data.scenario.week.from, data.scenario.week.to).filter((d) => data.daily.some((r) => r.date === d)).length,
    daysExpected: datesBetween(data.scenario.week.from, data.scenario.week.to).length,
  };
}
