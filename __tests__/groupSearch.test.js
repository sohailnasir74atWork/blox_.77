import { groupSearchToken, groupSearchWords, groupNameMatches } from '../Code/ChatScreen/utils/groupSearch';

const { searchKeysFor, wordsOf } = require('../functions/groupSearchKeys');

const NAMES = [
  'Blox Trade Hub', 'BLOX-trade_hub!!', '🔥 Fire Fruits 🔥', 'トレード 募集', 'Ｆｕｌｌ　Ｗｉｄｔｈ',
  "Kitsune's Den", 'Обмен фруктами', 'تبادل الفواكه', 'trade+values=fun', 'a',
  'Supercalifragilisticexpialidocious traders',
];

test('the app splits words exactly like the server', () => {
  for (const name of NAMES) expect(groupSearchWords(name)).toEqual(wordsOf(name));
});

test('every search token the app sends is one of the server keys of a matching name', () => {
  const cases = [
    ['Blox Trade Hub', 'blox'], ['Blox Trade Hub', 'TRA'], ['Blox Trade Hub', 'hub trade'],
    ['🔥 Fire Fruits 🔥', 'fire'], ['🔥 Fire Fruits 🔥', '🔥fru'], ['トレード 募集', 'トレ'],
    ['Ｆｕｌｌ　Ｗｉｄｔｈ', 'full'], ["Kitsune's Den", 'kitsune'], ['Обмен фруктами', 'фрук'],
    ['Supercalifragilisticexpialidocious traders', 'supercalifragilisticexpialidocious'],
  ];
  for (const [name, text] of cases) {
    expect(searchKeysFor(name)).toContain(groupSearchToken(text));
    expect(groupNameMatches(name, text)).toBe(true);
  }
});

test('non-matches and empty input', () => {
  expect(groupNameMatches('Blox Trade Hub', 'trade fish')).toBe(false);
  expect(groupNameMatches('Blox Trade Hub', 'rade')).toBe(false); // prefixes, not substrings
  expect(groupSearchToken('   ')).toBe('');
  expect(groupSearchToken('!!!')).toBe('');
  expect(searchKeysFor('')).toEqual([]);
  expect(searchKeysFor('x'.repeat(200)).length).toBe(20);
});
