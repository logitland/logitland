import { describe, expect, it } from 'vitest';
import { compound } from './services/xp/vader';

// Expected scores are the reference implementation's published output:
// https://github.com/cjhutto/vaderSentiment/blob/master/README.rst ("Demo, including example of non-English text").
// The neutral row has no lexicon word, which the reference scores 0.
const cases: [rule: string, text: string, score: number][] = [
  ['plain lexicon words', 'VADER is smart, handsome, and funny.', 0.8316],
  ['exclamation emphasis', 'VADER is smart, handsome, and funny!', 0.8439],
  ['booster word', 'VADER is very smart, handsome, and funny.', 0.8545],
  ['ALL CAPS among mixed case', 'VADER is VERY SMART, handsome, and FUNNY.', 0.9227],
  ['slang boosters with caps and capped exclamations', 'VADER is VERY SMART, uber handsome, and FRIGGIN FUNNY!!!', 0.9469],
  ['negation', 'VADER is not smart, handsome, nor funny.', -0.7424],
  ['"at least" and an n\'t contraction', "At least it isn't a horrible book.", 0.431],
  ['"kind of" dampener', 'The book was only kind of good.', 0.3832],
  ['"but" shifts weight to what follows', 'The plot was good, but the characters are uncompelling and the dialog is not great.', -0.7042],
  ['caps on a single word', 'Today SUX!', -0.5461],
  ['dampener, slang and capitalised "But"', "Today only kinda sux! But I'll get by, lol", 0.5249],
  ['emoticons', 'Make sure you :) or :D today!', 0.8633],
  ['capitalised negation', 'Not bad at all', 0.431],
  ['neutral', 'The relay runs on Cloudflare Workers.', 0],
];

describe('VADER compound score', () => {
  it.each(cases)('matches the reference for %s', (_rule, text, score) => {
    expect(compound(text)).toBeCloseTo(score, 3);
  });
});
