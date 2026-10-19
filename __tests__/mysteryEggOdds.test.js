import { EGGS, RARITY } from '../Code/Engagement/shopItems';
import { rollReward } from '../Code/Engagement/shopUtils';

jest.mock('@react-native-firebase/database', () => ({}));
jest.mock('../Code/Helper/cosmeticsCache', () => ({ updateMyCosmeticType: jest.fn() }));
jest.mock('../Code/Engagement/starUtils', () => ({ spendStars: jest.fn() }));

// Odds approved 2026-10-19 (Senior Mod suggestion): small buff to the top tier of each egg.
const EXPECTED = {
  common_fruit: { common: 65, uncommon: 27, rare: 8, legendary: 0, exclusive: 0 },
  rare_fruit: { common: 45, uncommon: 35, rare: 20, legendary: 0, exclusive: 0 },
  legendary_fruit: { common: 0, uncommon: 25, rare: 50, legendary: 25, exclusive: 0 },
  mythical_fruit: { common: 0, uncommon: 0, rare: 35, legendary: 40, exclusive: 25 },
};
const COSTS = { common_fruit: 3, rare_fruit: 7, legendary_fruit: 15, mythical_fruit: 30 };

describe('Mystery Egg odds', () => {
  it('match the approved table and keep their star costs', () => {
    expect(Object.keys(EGGS).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [id, table] of Object.entries(EXPECTED)) {
      expect(EGGS[id].dropTable).toEqual(table);
      expect(EGGS[id].cost).toBe(COSTS[id]);
    }
  });

  it('add up to 100 per egg, so the shown weights are percentages', () => {
    for (const egg of Object.values(EGGS)) {
      const total = Object.values(egg.dropTable).reduce((sum, w) => sum + w, 0);
      expect(total).toBe(100);
    }
  });

  it('rollReward picks each rarity in proportion to its weight', () => {
    const spy = jest.spyOn(Math, 'random');
    try {
      for (const [id, table] of Object.entries(EXPECTED)) {
        // Step the rarity roll through 1000 evenly spaced points; the item pick uses 0.
        const counts = {};
        for (let i = 0; i < 1000; i++) {
          spy.mockReturnValueOnce((i + 0.5) / 1000).mockReturnValueOnce(0);
          const item = rollReward(id);
          counts[item.rarity] = (counts[item.rarity] || 0) + 1;
        }
        for (const rarity of Object.values(RARITY)) {
          expect((counts[rarity] || 0) / 10).toBe(table[rarity]);
        }
      }
    } finally {
      spy.mockRestore();
    }
  });
});
