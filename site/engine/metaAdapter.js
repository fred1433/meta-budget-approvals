// Meta Marketing API adapter. It PREPARES requests for an explicit API version and hands them
// to a transport. The only transport in this repository is the local simulator: nothing here
// can reach graph.facebook.com.
import { centsParam } from './money.js';

export const API_VERSION = 'v25.0'; // Marketing API v25.0, released Feb 18, 2026 (Meta changelog, read Nov 3, 2026)
const READ_FIELDS = 'daily_budget,lifetime_budget,updated_time,effective_status';

export function prepareRead(objectId) {
  return {
    method: 'GET',
    url: `https://graph.facebook.com/${API_VERSION}/${objectId}`,
    objectId,
    query: { fields: READ_FIELDS },
  };
}

// Budgets live on the ad set (or the campaign with campaign budget), never on an ad.
export function prepareBudgetUpdate(objectId, toCents, { validateOnly = false, level = 'adset' } = {}) {
  if (!['adset', 'campaign'].includes(level)) throw new Error(`A budget is set on an ad set or a campaign, not on ${level === 'ad' ? 'an ad' : level}`);
  const body = { daily_budget: centsParam(toCents) };
  if (validateOnly) body.execution_options = ['validate_only'];
  return { method: 'POST', url: `https://graph.facebook.com/${API_VERSION}/${objectId}`, objectId, body };
}

export class MetaAdapter {
  constructor(transport) {
    this.transport = transport;
  }
  read(objectId) {
    const req = prepareRead(objectId);
    const res = this.transport.handle(req);
    return { req, res, dailyBudget: Number(res.body.daily_budget), updatedMs: Date.parse(res.body.updated_time), lastEditor: res.body._sim_last_editor };
  }
  updateBudget(objectId, toCents) {
    const req = prepareBudgetUpdate(objectId, toCents);
    const res = this.transport.handle(req);
    return { req, res };
  }
}
