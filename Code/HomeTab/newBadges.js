/**
 * newBadges.js — "NEW" tags on Home that disappear once the player has
 * opened that thing (2026-10-31: Sea Beast Raid; ported from MM2). Per
 * device, in MMKV; reads are synchronous so the tag is right on the first
 * frame.
 */

let store;
try {
  const { createMMKV } = require('react-native-mmkv');
  store = createMMKV({ id: 'home-new' });
} catch (e) {
  const mem = new Map();
  store = { getBoolean: (k) => mem.get(k), set: (k, v) => mem.set(k, v) };
}

export const isNew = (key) => {
  try {
    return store.getBoolean(`seen:${key}`) !== true;
  } catch (e) {
    return false;
  }
};

export const markSeen = (key) => {
  try {
    store.set(`seen:${key}`, true);
  } catch (e) {
    // The tag just shows again next time.
  }
};
