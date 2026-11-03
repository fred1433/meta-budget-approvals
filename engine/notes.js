// Plain-language notes were drafted OFFLINE by a language model and frozen in agentNotes.js.
// The model only picks a stance identifier and writes prose; names, reasons, dates and numbers
// on the page come from code. A note is shown only if it passes this validator AND its stance
// equals the verdict the code computed. Nothing calls a model when the page runs.

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'half', 'double', 'doubled', 'twice', 'triple', 'tripled', 'dozen', 'percent', 'percentage', 'first', 'second', 'third', 'fourth', 'fifth', 'once', 'both', 'single', 'pair', 'couple'];
// Proper names that must come from code, never from the note.
export const NAME_DENYLIST = ['katia', 'catherine', 'rudnick', 'andrew', 'frederic', 'crystal', 'cross', 'boho', 'bogo', 'wrap', 'wraps', 'inner', 'light', 'meta', 'facebook', 'instagram', 'shopify', 'klaviyo', 'november', 'october', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'yesterday', 'tomorrow'];
export const STANCES = ['increase', 'hold', 'suspected_review', 'no_signal', 'insufficient_data'];

export function validateNote(note, verdict) {
  const problems = [];
  if (!STANCES.includes(note.stance)) problems.push(`unknown stance ${note.stance}`);
  if (note.stance !== verdict) problems.push(`stance ${note.stance} differs from computed verdict ${verdict}`);
  const t = note.text ?? '';
  if (/\d/.test(t)) problems.push('contains a digit');
  if (/[$%€£#@]/.test(t)) problems.push('contains a currency, percent or id symbol');
  const words = t.toLowerCase().match(/[a-z']+/g) ?? [];
  for (const w of words) {
    const base = w.replace(/'s$/, '');
    if (NUMBER_WORDS.includes(base)) problems.push(`number word "${w}"`);
    if (NAME_DENYLIST.includes(base)) problems.push(`name "${w}"`);
  }
  // Any capitalised word that does not start a sentence is treated as a name.
  const sentences = t.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const toks = s.trim().split(/\s+/).slice(1);
    for (const tok of toks) if (/^[A-Z]/.test(tok.replace(/^["'(]/, ''))) problems.push(`capitalised word mid-sentence "${tok}"`);
  }
  // Causal or over-confident conclusions a note may not draw on its own.
  const OVERREACH = [/\bmostly buys\b/i, /\bis the limit\b/i, /\bis the auction\b/i, /\bnot (this|the) (video|ad|creative)\b/i, /\bis caused by\b/i, /\bdue to\b/i, /\bbecause of\b/i, /\bproves?\b/i, /\bguarantee/i, /\bwill (increase|grow|double|lift)\b/i];
  for (const re of OVERREACH) if (re.test(t)) problems.push(`over-confident or causal claim (${re.source})`);
  if (t.length > 260) problems.push('longer than 260 characters');
  return { ok: problems.length === 0, problems };
}
