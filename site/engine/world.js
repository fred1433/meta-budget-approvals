// A fresh, self-contained world: synthetic data, local simulator, adapter, executor.
// The page and the tests build worlds the same way.
import { DATA } from './syntheticData.js';
import { LocalMetaSimulator } from './simulator.js';
import { MetaAdapter } from './metaAdapter.js';
import { Executor, DEFAULT_LIMITS } from './executor.js';
import { evaluateScale } from './policy.js';
import { dataStatusFromScenario } from './metrics.js';

export function createWorld({ clock, dataStatus } = {}) {
  const manual = { t: Date.parse(DATA.scenario.now_utc) };
  const now = clock ?? (() => manual.t);
  const sim = new LocalMetaSimulator({
    clock: now,
    objects: DATA.adsets.map((a) => ({ id: a.id, name: a.name, daily_budget_cents: a.daily_budget_cents, effective_status: a.effective_status, updated_ms: Date.parse(a.updated_utc), last_editor: 'a person in Ads Manager' })),
  });
  const adapter = new MetaAdapter(sim);
  const status = { ...dataStatusFromScenario(), ...(dataStatus ?? {}) };
  const executor = new Executor({ adapter, clock: now, limits: DEFAULT_LIMITS, dataStatus: () => status });
  const advance = (seconds) => { manual.t += seconds * 1000; };
  const propose = (adsetId) => {
    const read = adapter.read(adsetId);
    return evaluateScale(adsetId, { now: now(), budgetRead: read, dataStatus: status });
  };
  return { sim, adapter, executor, status, advance, propose, now };
}
