// Meta and Shopify read separately for the same week, then the gap split into what can be
// explained from each source's own data. What cannot be explained stays "unexplained".
import { DATA } from './syntheticData.js';
import { localDate } from './time.js';

const inWeek = (ms, w) => { const d = localDate(ms); return d >= w.from && d <= w.to; };
// Shopify-style last non-direct click: a direct visit never takes the credit from the last non-direct channel.
export function creditedChannel(journey) {
  if (journey.last.source !== 'direct') return journey.last.source;
  if (journey.first.source !== 'direct') return journey.first.source;
  return 'direct';
}
const net = (o) => o.lines.reduce((s, l) => s + l.price_cents * l.qty, 0) - o.discount_cents;

export function reconcile(data = DATA) {
  const w = data.scenario.week;
  const ids = new Set(data.adsets.map((a) => a.id));
  // Meta reading: attributed purchases by window, dated on the impression.
  const clickOrders = data.orders.filter((o) => o.meta_click && ids.has(o.meta_click.adset_id) && inWeek(Date.parse(o.meta_click.at), w));
  const unmatched = data.meta_unmatched.filter((u) => inWeek(Date.parse(u.touch_utc), w));
  const extra = data.meta_extra.filter((x) => inWeek(Date.parse(x.touch_utc), w));
  const sumV = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const meta = {
    click: { n: clickOrders.length + unmatched.length, value: sumV(clickOrders, net) + sumV(unmatched, (u) => u.value_cents) },
    engage: { n: extra.filter((x) => x.type === 'engage_through_1d').length, value: sumV(extra.filter((x) => x.type === 'engage_through_1d'), (x) => x.value_cents) },
    view: { n: extra.filter((x) => x.type === 'view_1d').length, value: sumV(extra.filter((x) => x.type === 'view_1d'), (x) => x.value_cents) },
    readAt: Date.parse(data.scenario.reads.meta_insights_utc),
  };
  meta.total = { n: meta.click.n + meta.engage.n + meta.view.n, value: meta.click.value + meta.engage.value + meta.view.value };

  // Shopify reading: orders created this week in the simulated store, and returns processed this week.
  const weekOrders = data.orders.filter((o) => inWeek(Date.parse(o.created_utc), w));
  const gross = sumV(weekOrders, (o) => o.lines.reduce((s, l) => s + l.price_cents * l.qty, 0));
  const discounts = sumV(weekOrders, (o) => o.discount_cents);
  const returnsWeek = data.returns.filter((r) => inWeek(Date.parse(r.processed_utc), w));
  const returns = sumV(returnsWeek, (r) => r.amount_cents);
  const shopify = {
    orders: weekOrders.length, gross, discounts, returns, returnsCount: returnsWeek.length,
    netSales: gross - discounts - returns,
    taxes: sumV(weekOrders, (o) => o.tax_cents), shipping: sumV(weekOrders, (o) => o.shipping_cents),
    readAt: Date.parse(data.scenario.reads.shopify_orders_utc),
  };
  // Shopify's own attribution: last click from Meta, order dated on its creation.
  const lastMeta = weekOrders.filter((o) => creditedChannel(o.journey) === 'meta');
  const shopifyMeta = { n: lastMeta.length, value: sumV(lastMeta, net), readAt: Date.parse(data.scenario.reads.shopify_attribution_utc), model: 'last non-direct click (UTM)', note: 'order value credited to Meta, after discounts and before returns' };

  const gap = meta.total.value - shopifyMeta.value;
  // Explained from Meta's own breakdown: engage-through and view conversions have no Meta click to credit in Shopify.
  const viewEngage = meta.engage.value + meta.view.value;
  // Explained from Shopify journeys: a Meta click came first but another channel had the last click.
  const otherLast = clickOrders.filter((o) => creditedChannel(o.journey) !== 'meta' && inWeek(Date.parse(o.created_utc), w));
  // Explained by dates: click inside the week, order after it (Meta counts it, Shopify not this week) minus the reverse.
  const clickInOrderAfter = clickOrders.filter((o) => creditedChannel(o.journey) === 'meta' && !inWeek(Date.parse(o.created_utc), w));
  const clickBeforeOrderIn = lastMeta.filter((o) => o.meta_click && !inWeek(Date.parse(o.meta_click.at), w));
  const dateShift = sumV(clickInOrderAfter, net) - sumV(clickBeforeOrderIn, net);
  const otherLastValue = sumV(otherLast, net) + sumV(clickOrders.filter((o) => creditedChannel(o.journey) !== 'meta' && !inWeek(Date.parse(o.created_utc), w)), net);
  const explained = viewEngage + otherLastValue + dateShift;
  const lines = [
    { id: 'view_engage', status: 'assumed', value: viewEngage, text: 'Engage-through and 1-day view purchases: Meta counts them; this scenario assumes Shopify credits them to another channel', source: 'Meta breakdown by attribution window' },
    { id: 'other_last_click', status: 'explained', value: otherLastValue, text: `Purchases after a Meta link click where another non-direct channel (email) had the last click (${otherLast.length} this week)`, source: 'Shopify customer journeys' },
    { id: 'date_convention', status: 'explained', value: dateShift, text: 'Meta dates a purchase on the impression, Shopify on the order, so the week edges differ', source: 'Both readings, compared by date' },
    { id: 'unexplained', status: 'unexplained', value: gap - explained, text: 'Not matched to any order or journey. Possible causes include duplicated browser and server events; not confirmed', source: 'Remainder' },
  ];
  return { week: w, meta, shopify, shopifyMeta, gap, lines };
}

export function scene(data = DATA) {
  const o = data.orders.find((x) => x.id === data.scene.order_id);
  const r = data.returns.find((x) => x.order_id === o.id);
  return { order: o, ret: r, ...data.scene, value: net(o) };
}
