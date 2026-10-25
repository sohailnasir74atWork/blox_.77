// Fruit Cards components render for every rarity × finish, and the hub,
// album and Home card draw from the dev mock without throwing.
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');
jest.mock('react-native-vector-icons/FontAwesome6', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, o) => (o && o.defaultValue) || key, i18n: { language: 'en' } }),
}));

const FruitCard = require('../Code/FruitCards/FruitCard').default;
const CardBack = require('../Code/FruitCards/CardBack').default;
const PackArt = require('../Code/FruitCards/PackArt').default;
const RarityGem = require('../Code/FruitCards/RarityGem').default;
const ProfileShowcase = require('../Code/FruitCards/ProfileShowcase').default;
const { RARITIES, FINISHES, THEMES } = require('../Code/FruitCards/cardConfig');

const render = (el) => {
  let tree;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(el); });
  return tree;
};
const texts = (tree) => tree.root.findAllByType(Text).map((n) => [].concat(n.props.children).join(''));

const FAMILIES = { common: 'natural', uncommon: 'natural', rare: 'logia', legendary: 'beast', mythical: 'beast', limited: 'skin' };

describe('FruitCard', () => {
  RARITIES.forEach((rarity) => {
    FINISHES.forEach((finish) => {
      it(`${rarity} · ${finish}`, () => {
        const card = { key: `x${rarity}`, name: `Test ${rarity}`, rarity, no: 7, family: FAMILIES[rarity], sets: [], bg: null };
        const serial = ['holo', 'gilded', 'aura', 'fullart'].includes(finish) ? 42 : null;
        const full = render(<FruitCard card={card} finish={finish} serial={serial} width={300} />);
        const t = texts(full);
        expect(t).toContain(`Test ${rarity}`);
        expect(t).toContain('#7');                                   // number alone, never no/total
        if (serial) expect(t).toContain('#0042');
        render(<FruitCard card={card} finish={finish} width={104} size="thumb" owned={false} />);
      });
    });
  });
  it('labels the family on the type line', () => {
    const t = texts(render(<FruitCard card={{ key: 'k', name: 'Kitsune', rarity: 'mythical', no: 1, family: 'beast', sets: [] }} />));
    expect(t).toContain('beast');   // t(fruit_cards.family.beast, { defaultValue: family })
  });
  it('stamps a serial-less Mythic Aura as fused', () => {
    const t = texts(render(<FruitCard card={{ key: 'k', name: 'K', rarity: 'rare', no: 1, family: 'natural', sets: [] }} finish="aura" />));
    expect(t).toContain('FRUIT_CARDS.FUSED_STAMP');
  });
});

describe('pack, back, gem, showcase', () => {
  it('draws every theme', () => {
    Object.keys(THEMES).forEach((theme) => {
      render(<PackArt width={170} theme={theme} title="All Fruits" subtitle="3 CARDS" />);
      render(<CardBack width={200} theme={theme} />);
    });
  });
  it('draws every rarity gem', () => {
    RARITIES.forEach((r) => render(<RarityGem rarity={r} size={20} glow />));
  });
  it('profile showcase draws stored entries and hides when empty', () => {
    const tree = render(<ProfileShowcase cards={[{ k: 'kitsune', f: 'aura', s: 3, n: 'Kitsune', r: 'mythical', no: 60, fa: 'beast', sets: ['beast'] }]} score={120} />);
    expect(texts(tree)).toContain('Kitsune');
    expect(render(<ProfileShowcase cards={[]} score={0} />).toJSON()).toBeNull();
  });
});
