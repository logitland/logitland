import { VADER_LEXICON } from './vader-lexicon';

// A port of VADER's compound score (Hutto & Gilbert, ICWSM 2014), following cjhutto/vaderSentiment's vaderSentiment.py rule for rule.
// Two deliberate differences from the reference:
// - Emoji are not translated to their text descriptions first, so an emoji scores 0.
// - "but" scales every word by its position. The reference looks words up by value, which misfires when two words share a valence.

const B_INCR = 0.293;
const B_DECR = -0.293;
/** Added to a word written in ALL CAPS while the rest of the text isn't. */
const C_INCR = 0.733;
/** Multiplier for a negated word. */
const N_SCALAR = -0.74;
/** How strongly the raw sum is squashed into (−1, 1); approximates the largest expected sum. */
const ALPHA = 15;
/** A booster's effect fades with its distance from the word it modifies: 1, 2 or 3 words back. */
const BOOSTER_DAMPING = [1, 0.95, 0.9];
const EXCLAMATION_INCR = 0.292;
const MAX_EXCLAMATIONS = 4;
const QUESTION_INCR = 0.18;
const MAX_QUESTION_AMPLIFIER = 0.96;

const NEGATIONS = new Set([
  ...['aint', 'arent', 'cannot', 'cant', 'couldnt', 'darent', 'didnt', 'doesnt', "ain't", "aren't", "can't", "couldn't", "daren't", "didn't", "doesn't"],
  ...['dont', 'hadnt', 'hasnt', 'havent', 'isnt', 'mightnt', 'mustnt', 'neither', "don't", "hadn't", "hasn't", "haven't", "isn't", "mightn't", "mustn't"],
  ...['neednt', "needn't", 'never', 'none', 'nope', 'nor', 'not', 'nothing', 'nowhere', 'oughtnt', 'shant', 'shouldnt', 'uhuh', 'wasnt', 'werent'],
  ...["oughtn't", "shan't", "shouldn't", 'uh-uh', "wasn't", "weren't", 'without', 'wont', 'wouldnt', "won't", "wouldn't", 'rarely', 'seldom', 'despite'],
]);

const INCREASERS = [
  ...['absolutely', 'amazingly', 'awfully', 'completely', 'considerable', 'considerably', 'decidedly', 'deeply', 'effing', 'enormous', 'enormously'],
  ...['entirely', 'especially', 'exceptional', 'exceptionally', 'extreme', 'extremely', 'fabulously', 'flipping', 'flippin', 'frackin', 'fracking'],
  ...['fricking', 'frickin', 'frigging', 'friggin', 'fully', 'fuckin', 'fucking', 'fuggin', 'fugging', 'greatly', 'hella', 'highly', 'hugely'],
  ...['incredible', 'incredibly', 'intensely', 'major', 'majorly', 'more', 'most', 'particularly', 'purely', 'quite', 'really', 'remarkably', 'so'],
  ...['substantially', 'thoroughly', 'total', 'totally', 'tremendous', 'tremendously', 'uber', 'unbelievably', 'unusually', 'utter', 'utterly', 'very'],
];
const DECREASERS = [
  ...['almost', 'barely', 'hardly', 'just enough', 'kind of', 'kinda', 'kindof', 'kind-of', 'less', 'little', 'marginal', 'marginally', 'occasional'],
  ...['occasionally', 'partly', 'scarce', 'scarcely', 'slight', 'slightly', 'somewhat', 'sort of', 'sorta', 'sortof', 'sort-of'],
];
/** Degree adverbs that strengthen or weaken the sentiment word after them. */
const BOOSTERS = new Map([...INCREASERS.map((word) => [word, B_INCR] as const), ...DECREASERS.map((word) => [word, B_DECR] as const)]);

/** Phrases around a lexicon word whose valence replaces the word's own. */
const SPECIAL_CASES = new Map([
  ['the shit', 3],
  ['the bomb', 3],
  ['bad ass', 1.5],
  ['badass', 1.5],
  ['bus stop', 0],
  ['yeah right', -2],
  ['kiss of death', -1.5],
  ['to die for', 3],
  ['beating heart', 3.1],
  ['broken heart', -2.9],
]);

// Python's string.punctuation, stripped from both ends of each token.
const EDGE_PUNCTUATION = /^[!-/:-@[-`{-~]+|[!-/:-@[-`{-~]+$/g;

// Keyed `string | undefined` so a lookup past either end of the text simply misses, as the rules probe up to three neighbours.
let lexicon: ReadonlyMap<string | undefined, number> | undefined;

/** The lexicon, parsed on first use and kept for the life of the isolate. */
function getLexicon(): ReadonlyMap<string | undefined, number> {
  lexicon ??= new Map(
    VADER_LEXICON.split('\n').map((line) => {
      const space = line.lastIndexOf(' ');
      return [line.slice(0, space), Number(line.slice(space + 1))];
    }),
  );
  return lexicon;
}

/**
 * VADER's compound sentiment score for `text`: −1 is most negative, 1 most positive.
 * The reference treats ≥ 0.05 as positive, ≤ −0.05 as negative and anything between as neutral.
 */
export function compound(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).map(stripPunctuation);
  const lower = words.map((word) => word.toLowerCase());
  const caps = words.filter(isUpper).length;
  const capDiff = caps > 0 && caps < words.length;

  let sentiments = words.map((word, i) => {
    const modifier = BOOSTERS.has(word.toLowerCase()) || (word.toLowerCase() === 'kind' && lower[i + 1] === 'of');
    return modifier ? 0 : wordValence(word, i, words, lower, capDiff);
  });

  // Contrastive "but": what comes after it counts more than what came before.
  const but = lower.indexOf('but');
  if (but >= 0) sentiments = sentiments.map((s, i) => (i < but ? s * 0.5 : i > but ? s * 1.5 : s));

  const sum = sentiments.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  const total = sum + Math.sign(sum) * punctuationEmphasis(text);
  return total / Math.sqrt(total * total + ALPHA);
}

/** Trims edge punctuation unless that leaves two characters or fewer, which is likely an emoticon such as ":)". */
function stripPunctuation(token: string): string {
  const stripped = token.replace(EDGE_PUNCTUATION, '');
  return [...stripped].length <= 2 ? token : stripped;
}

/** Python's str.isupper: has a cased character, and every cased character is upper case. */
function isUpper(word: string): boolean {
  return word !== word.toLowerCase() && word === word.toUpperCase();
}

function isNegation(word: string | undefined): boolean {
  return word !== undefined && (NEGATIONS.has(word) || word.includes("n't"));
}

/** The valence of `word`, at `i` in `words`, adjusted for the up to three words before it. */
function wordValence(word: string, i: number, words: string[], lower: string[], capDiff: boolean): number {
  const lex = getLexicon();
  const base = lex.get(lower[i]);
  if (base === undefined) return 0;
  let valence = base;

  // "no" right before another lexicon word negates that word instead of scoring itself.
  if (lower[i] === 'no' && lex.has(lower[i + 1])) valence = 0;
  if (lower[i - 1] === 'no' || lower[i - 2] === 'no' || (lower[i - 3] === 'no' && (lower[i - 1] === 'or' || lower[i - 1] === 'nor'))) {
    valence = base * N_SCALAR;
  }

  if (capDiff && isUpper(word)) valence += valence > 0 ? C_INCR : -C_INCR;

  for (const [distance, damping] of BOOSTER_DAMPING.entries()) {
    const prior = words[i - distance - 1];
    if (prior === undefined || lex.has(prior.toLowerCase())) continue;
    valence += boosterScalar(prior, valence, capDiff) * damping;
    valence = negationCheck(valence, lower, distance, i);
    if (distance === 2) valence = idiomsCheck(valence, lower, i);
  }

  // "least" before a word negates it, except in "at least" and "very least".
  if (lower[i - 1] === 'least' && lower[i - 2] !== 'at' && lower[i - 2] !== 'very') valence *= N_SCALAR;
  return valence;
}

/** How much a booster word pushes `valence` away from zero, more if it alone is in ALL CAPS. */
function boosterScalar(word: string, valence: number, capDiff: boolean): number {
  const boost = BOOSTERS.get(word.toLowerCase());
  if (boost === undefined) return 0;
  let scalar = valence < 0 ? -boost : boost;
  if (capDiff && isUpper(word)) scalar += valence > 0 ? C_INCR : -C_INCR;
  return scalar;
}

/** Negates `valence` if the word `distance + 1` back is a negation, with the reference's "never so/this" and "without doubt" exceptions. */
function negationCheck(valence: number, lower: string[], distance: number, i: number): number {
  const back = (n: number) => lower[i - n];
  const soOrThis = (word: string | undefined) => word === 'so' || word === 'this';

  // "never so good" and "never this good" intensify rather than negate. At three words back the reference also
  // intensifies whenever the previous word is "so" or "this"; kept for fidelity.
  if (distance === 1 && back(2) === 'never' && soOrThis(back(1))) return valence * 1.25;
  if (distance === 2 && ((back(3) === 'never' && soOrThis(back(2))) || soOrThis(back(1)))) return valence * 1.25;
  if (distance === 1 && back(2) === 'without' && back(1) === 'doubt') return valence;
  if (distance === 2 && back(3) === 'without' && (back(2) === 'doubt' || back(1) === 'doubt')) return valence;
  return isNegation(back(distance + 1)) ? valence * N_SCALAR : valence;
}

/** Applies special-case phrases spanning the word at `i`, and two- or three-word boosters such as "kind of" before it. */
function idiomsCheck(valence: number, lower: string[], i: number): number {
  const phrase = (from: number, to: number) => lower.slice(i + from, i + to + 1).join(' ');

  const before = [phrase(-1, 0), phrase(-2, 0), phrase(-2, -1), phrase(-3, -1), phrase(-3, -2)];
  valence = before.map((seq) => SPECIAL_CASES.get(seq)).find((special) => special !== undefined) ?? valence;
  if (i + 1 < lower.length) valence = SPECIAL_CASES.get(phrase(0, 1)) ?? valence;
  if (i + 2 < lower.length) valence = SPECIAL_CASES.get(phrase(0, 2)) ?? valence;

  for (const seq of [phrase(-3, -1), phrase(-3, -2), phrase(-2, -1)]) valence += BOOSTERS.get(seq) ?? 0;
  return valence;
}

/** Up to four "!" each add emphasis; two or more "?" add emphasis too. */
function punctuationEmphasis(text: string): number {
  const exclamations = Math.min(text.split('!').length - 1, MAX_EXCLAMATIONS);
  const questions = text.split('?').length - 1;
  const questionEmphasis = questions <= 1 ? 0 : questions <= 3 ? questions * QUESTION_INCR : MAX_QUESTION_AMPLIFIER;
  return exclamations * EXCLAMATION_INCR + questionEmphasis;
}
