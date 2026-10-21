import {
  setDmUnread, removeDmUnread, clearDmUnread, acknowledgeDmBadge,
  setGroupUnread, clearGroupUnread, acknowledgeGroupBadge,
} from '../Code/ChatScreen/chatBadgeStore';

// The hook is useSyncExternalStore over this snapshot; read it through a tiny
// subscriber instead of rendering.
const store = require('../Code/ChatScreen/chatBadgeStore');
const read = () => {
  let value;
  const React = require('react');
  const ReactTestRenderer = require('react-test-renderer');
  const Probe = () => { value = store.useChatBadges(); return null; };
  let r;
  ReactTestRenderer.act(() => { r = ReactTestRenderer.create(React.createElement(Probe)); });
  ReactTestRenderer.act(() => r.unmount());
  return value;
};

beforeEach(() => {
  clearDmUnread();
  clearGroupUnread();
});

test('sums per-chat counts and follows updates and removals', () => {
  setDmUnread('a', 2);
  setDmUnread('b', 3);
  expect(read().dm).toBe(5);
  setDmUnread('a', 4); // a new message in chat a
  expect(read().dm).toBe(7);
  setDmUnread('b', 0); // chat b was read
  expect(read().dm).toBe(4);
  removeDmUnread('a');
  expect(read().dm).toBe(0);
});

test('tapping the button acknowledges; only newer messages show after it', () => {
  setDmUnread('a', 5);
  setDmUnread('b', 10);
  acknowledgeDmBadge();
  expect(read().dm).toBe(0);
  // One more message in a: the badge says 1, not 16 (the old tap-to-zero
  // came back with the full total on the next event).
  setDmUnread('a', 6);
  expect(read().dm).toBe(1);
  // Chat a is read (server count 0), then a new message arrives: 1 again.
  setDmUnread('a', 0);
  expect(read().dm).toBe(0);
  setDmUnread('a', 1);
  expect(read().dm).toBe(1);
  // b never changed since the tap.
  setDmUnread('b', 10);
  expect(read().dm).toBe(1);
});

test('dm and group badges are independent', () => {
  setDmUnread('a', 2);
  setGroupUnread('g1', 7);
  expect(read()).toEqual({ dm: 2, group: 7 });
  acknowledgeGroupBadge();
  expect(read()).toEqual({ dm: 2, group: 0 });
  setGroupUnread('g1', 9);
  expect(read()).toEqual({ dm: 2, group: 2 });
});

test('no re-render when a change leaves the totals as they were', () => {
  const React = require('react');
  const ReactTestRenderer = require('react-test-renderer');
  let renders = 0;
  const Probe = () => { store.useChatBadges(); renders += 1; return null; };
  setDmUnread('a', 3);
  let probe;
  ReactTestRenderer.act(() => { probe = ReactTestRenderer.create(React.createElement(Probe)); });
  renders = 0;
  ReactTestRenderer.act(() => {
    setDmUnread('a', 3);        // same count again (e.g. a mute toggle echo)
    setGroupUnread('g', 0);     // a group with nothing unread
  });
  expect(renders).toBe(0);
  ReactTestRenderer.act(() => { setDmUnread('a', 4); });
  expect(renders).toBe(1);
  ReactTestRenderer.act(() => probe.unmount());
});
