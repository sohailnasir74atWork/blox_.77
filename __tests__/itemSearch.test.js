import {matchesItemName} from '../Code/Helper/itemSearch';

test('Russian aliases find common pets, eggs, fruits and MM2 items', () => {
  for (const [name, query] of [
    ['Frost Dragon', 'ледяной дракон'], ['Safari Egg', 'яйцо'],
    ['Cat', 'кошка'], ['Ice', 'лед'], ['Ice', 'лёд'],
    ['Dough', 'тесто'], ['Chroma Luger', 'люгер'], ['Icewing', 'айсвинг'],
  ]) expect(matchesItemName(name, query)).toBe(true);
});

test('English search, whitespace and existing Adopt Me acronyms still work', () => {
  expect(matchesItemName('Frost Dragon', ' FROST ')).toBe(true);
  expect(matchesItemName('Lavender Dragon', 'ld', true)).toBe(true);
  expect(matchesItemName('Frost Dragon', '')).toBe(true);
  expect(matchesItemName(null, 'dragon')).toBe(false);
});

test('Japanese katakana, hiragana and old fruit names find Blox Fruits items', () => {
  for (const [name, query] of [
    ['Kitsune', 'キツネ'], ['Kitsune', 'きつね'], ['Tiger', 'レオパード'], ['Tiger', 'タイガー'],
    ['West Dragon', 'ドラゴン'], ['East Dragon', 'イーストドラゴン'], ['Dough', 'ドウ'],
    ['Lightning', 'ゴロゴロ'], ['Galaxy Empyrean Kitsune', 'キツネ'], ['Ice', 'ｱｲｽ'],
  ]) expect(matchesItemName(name, query)).toBe(true);
  expect(matchesItemName('Magma', 'キツネ')).toBe(false);
  expect(matchesItemName('West Dragon', 'イーストドラゴン')).toBe(false);
});

test('aliases do not match incidental substrings or unrelated items', () => {
  expect(matchesItemName('Caterpillar', 'кошка')).toBe(false);
  expect(matchesItemName('Dog', 'кошка')).toBe(false);
  expect(matchesItemName('Frost Dragon', 'теневой дракон')).toBe(false);
});
