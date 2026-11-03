// The model writes prose only; code writes names, reasons, dates and numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNote } from '../engine/notes.js';
import { AGENT_NOTES } from '../engine/agentNotes.js';

test('every frozen note passes and matches the verdict computed by code', () => {
  assert.ok(validateNote(AGENT_NOTES['P-SIM-AS-101'], 'increase').ok);
  assert.ok(validateNote(AGENT_NOTES['P-SIM-AS-102'], 'hold').ok);
  assert.ok(validateNote(AGENT_NOTES['fatigue-SIM-AS-103'], 'suspected_review').ok);
});

// Plausible wrong sentences a model could write. Each must be rejected.
const BAD = [
  ['Crystal Cross can take ten percent more.', 'increase'], // name + number word
  ['Katia approved this kind of raise last week.', 'increase'], // name at sentence start
  ['The team at Katia Designs saw the same drop.', 'hold'], // names mid-sentence
  ['Spend rose 18% after the promo.', 'hold'], // digits
  ['Both orders together came to about a hundred dollars.', 'hold'], // two orders combined
  ['The boho wraps are mostly bought by returning customers.', 'hold'], // product name
  ['Andrew should pause this video now.', 'suspected_review'], // person
  ['Frequency doubled since the launch.', 'suspected_review'], // number word
  ['Raise the budget; the signal is clear.', 'hold'], // stance contradicts the computed verdict
  ['Pause it.', 'pause'], // stance that does not exist
  ['Sales from Meta fell last Tuesday.', 'suspected_review'], // platform + day name
  ['The cost per purchase is $46, under target.', 'suspected_review'], // currency and digits
  ['Twice as many people saw it.', 'suspected_review'], // number word at start
  ['This buyer, Catherine, returned an item.', 'hold'], // name in commas
  ['New buyers arrive cheaply and the budget is the limit.', 'increase'], // causal overreach
  ['More budget here mostly buys repeat orders.', 'hold'], // causal overreach
  ['Costs rose, so this is the auction, not this video.', 'suspected_review'], // causal overreach
  ['Sales dropped due to the creative.', 'suspected_review'], // causal overreach
];
for (const [text, verdict] of BAD) {
  test(`rejects: ${text}`, () => {
    const stance = verdict === 'pause' ? 'pause' : /^Raise/.test(text) ? 'increase' : verdict;
    assert.equal(validateNote({ stance, text }, verdict).ok, false);
  });
}
