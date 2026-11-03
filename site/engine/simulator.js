// Local simulator of the few Graph API calls the executor needs. It is not Meta's sandbox ad
// account and it is not Meta: every response it returns carries simulated: true.
export class LocalMetaSimulator {
  constructor({ objects, clock }) {
    this.objects = Object.fromEntries(objects.map((o) => [o.id, { ...o }]));
    this.clock = clock;
    this.received = []; // every write that reached the "server"
    this.faults = { loseNextResponse: false };
  }
  handle(req) {
    const obj = this.objects[req.objectId];
    if (!obj) return { status: 400, simulated: true, source: 'local-simulator', body: { error: { message: 'Unknown object', code: 100 } } };
    if (req.method === 'GET') {
      return {
        status: 200, simulated: true, source: 'local-simulator',
        body: {
          id: obj.id, daily_budget: String(obj.daily_budget_cents), lifetime_budget: '0',
          updated_time: new Date(obj.updated_ms).toISOString(), effective_status: obj.effective_status,
          _sim_last_editor: obj.last_editor,
        },
      };
    }
    if (req.method === 'POST') {
      this.received.push({ at: this.clock(), objectId: req.objectId, body: { ...req.body } });
      if (req.body.execution_options?.includes('validate_only')) {
        return { status: 200, simulated: true, source: 'local-simulator', body: { success: true, validate_only: true } };
      }
      obj.daily_budget_cents = Number(req.body.daily_budget);
      obj.updated_ms = this.clock();
      obj.last_editor = 'the agent';
      if (this.faults.loseNextResponse) {
        this.faults.loseNextResponse = false;
        const e = new Error('Connection dropped after the request was sent; no response received');
        e.code = 'RESPONSE_LOST';
        throw e;
      }
      return { status: 200, simulated: true, source: 'local-simulator', body: { success: true } };
    }
    throw new Error(`Unsupported method ${req.method}`);
  }
  // A person edits the budget in Ads Manager (simulated).
  humanEdit(objectId, cents) {
    const obj = this.objects[objectId];
    obj.daily_budget_cents = cents;
    obj.updated_ms = this.clock();
    obj.last_editor = 'a person in Ads Manager';
  }
}
