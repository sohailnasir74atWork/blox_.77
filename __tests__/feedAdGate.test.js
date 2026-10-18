import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useFeedAdGate, useFeedAdActive } from '../Code/Ads/feedAdGate';

global.IS_REACT_ACT_ENVIRONMENT = true;

const ad = (id) => ({ __type: 'ad', id });
const row = (id) => ({ id });
const view = (...indexes) => ({ viewableItems: indexes.map((index) => ({ index })) });

// 18 rows with an ad after every 5th: ad-4 at index 5, ad-9 at 11, ad-14 at 17
const data = [];
for (let i = 0; i < 18; i++) {
  data.push(row(`r${i}`));
  if ((i + 1) % 5 === 0) data.push(ad(`ad-${i}`));
}

function makeGate() {
  let gate = null;
  const Host = () => {
    gate = useFeedAdGate(data);
    return null;
  };
  act(() => {
    TestRenderer.create(<Host />);
  });
  return gate;
}

describe('feedAdGate', () => {
  test('ad rows stay inactive until the list reports them near the screen', () => {
    const gate = makeGate();
    expect(gate.isActive('ad-4')).toBe(false);

    act(() => gate.onViewableItemsChanged(view(0, 1, 2))); // last visible 2, +4 → index 6
    expect(gate.isActive('ad-4')).toBe(true);
    expect(gate.isActive('ad-9')).toBe(false);
    expect(gate.isActive('ad-14')).toBe(false);

    act(() => gate.onViewableItemsChanged(view(6, 7, 8, 9))); // up to index 13
    expect(gate.isActive('ad-9')).toBe(true);
    expect(gate.isActive('ad-14')).toBe(false);
  });

  test('active is sticky: scrolling back up never deactivates', () => {
    const gate = makeGate();
    act(() => gate.onViewableItemsChanged(view(14, 15, 16)));
    expect(gate.isActive('ad-14')).toBe(true);
    act(() => gate.onViewableItemsChanged(view(0, 1)));
    expect(gate.isActive('ad-14')).toBe(true);
  });

  test('useFeedAdActive re-renders only when its own ad activates', () => {
    const gate = makeGate();
    let renders = 0;
    let value = null;
    const Slot = () => {
      renders += 1;
      value = useFeedAdActive(gate, 'ad-9');
      return null;
    };
    act(() => {
      TestRenderer.create(<Slot />);
    });
    expect(value).toBe(false);
    const before = renders;
    act(() => gate.onViewableItemsChanged(view(0, 1))); // activates ad-4 only
    expect(value).toBe(false);
    expect(renders).toBe(before);
    act(() => gate.onViewableItemsChanged(view(8, 9))); // activates ad-9
    expect(value).toBe(true);
  });

  test('no gate means the slot loads as before', () => {
    let value = null;
    const Slot = () => {
      value = useFeedAdActive(null, 'ad-4');
      return null;
    };
    act(() => {
      TestRenderer.create(<Slot />);
    });
    expect(value).toBe(true);
  });
});
