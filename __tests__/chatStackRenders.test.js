/**
 * How many times do the chat screens redraw when realtime updates arrive?
 *
 * Every screen is replaced by a counter, the Supabase subscriptions by
 * emitters we drive by hand, and the real React Navigation native stack sits
 * in between — the redraws we care about come from how ChatStack hands its
 * screens to that navigator.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockRenders = {};
const mockCount = (name) => { mockRenders[name] = (mockRenders[name] || 0) + 1; };
const mockScreen = (name, { memo = false } = {}) => {
  const Screen = () => { mockCount(name); return null; };
  return { __esModule: true, default: memo ? require('react').memo(Screen) : Screen };
};

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../Code/ChatScreen/GroupChat/Trader', () => mockScreen('publicChat'));
jest.mock('../Code/ChatScreen/PrivateChat/PrivateChat', () => mockScreen('dm'));
jest.mock('../Code/ChatScreen/GroupChat/InboxScreen', () => mockScreen('inbox', { memo: true }));
const mockLastGroups = { value: null };
jest.mock('../Code/ChatScreen/GroupChat/GroupsScreen', () => ({
  __esModule: true,
  default: ({ groups }) => { mockCount('groups'); mockLastGroups.value = groups; return null; },
}));
jest.mock('../Code/ChatScreen/GroupChat/GroupChatScreen', () => mockScreen('groupChat'));
jest.mock('../Code/ChatScreen/PrivateChat/PrivateChatHeader', () => mockScreen('dmHeader', { memo: true }));
jest.mock('../Code/ChatScreen/PrivateChat/BlockUserList', () => mockScreen('blocked'));
jest.mock('../Code/ChatScreen/PrivateChat/ImageViewer', () => mockScreen('imageViewer'));
jest.mock('../Code/ChatScreen/GroupChat/LeaderboardScreen', () => mockScreen('leaderboard'));
jest.mock('../Code/AppHelper/AdminDashboard', () => mockScreen('admin'));
jest.mock('../Code/AppHelper/SocialDashboard', () => mockScreen('social'));
jest.mock('../Code/ChatScreen/GroupChat/CommunityChatHeader', () => mockScreen('chatHeader'));
jest.mock('../Code/Design/componenets/ThemeHeader', () => ({
  __esModule: true,
  default: ({ rightContent }) => rightContent || null,
}));

const mockGlobal = { user: { id: 'me' }, appdatabase: {}, unreadMessagesCount: 0, onlineMembersCount: 0 };
jest.mock('../Code/GlobelStats', () => ({ useGlobalState: () => mockGlobal }));
const mockLocal = { localState: { bannedUsers: [] }, updateLocalState: () => {} };
jest.mock('../Code/LocalGlobelStats', () => ({ useLocalState: () => mockLocal }));
const mockHaptic = { triggerHapticFeedback: () => {} };
jest.mock('../Code/Helper/HepticFeedBack', () => ({ useHaptic: () => mockHaptic }));
const mockT = (k) => k;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('i18next', () => ({ t: (k) => k }));
jest.mock('@react-native-firebase/database', () => ({
  ref: () => ({}), update: () => Promise.resolve(), get: () => Promise.resolve({ exists: () => false }),
  onChildAdded: () => () => {}, onChildChanged: () => () => {}, onChildRemoved: () => () => {},
}));
jest.mock('../Code/Supabase/featureFlags', () => ({
  SUPABASE_CHAT_META_ENABLED: true,
  SUPABASE_GROUP_META_ENABLED: true,
}));

// Hand-driven realtime: tests call mockEmit.dm(...) / mockEmit.group(...).
const mockEmit = { dmHandlers: new Set(), groupHandlers: new Set() };
jest.mock('../Code/Supabase/chatMetaBackend', () => ({
  subscribeToChatMetaShared: (uid, h) => {
    mockEmit.dmHandlers.add(h);
    h.onReady?.();
    return () => mockEmit.dmHandlers.delete(h);
  },
  resetUnreadCount: () => Promise.resolve(),
  setActiveChatPartner: () => {},
  clearActiveChatPartner: () => false,
}));
jest.mock('../Code/Supabase/groupMetaBackend', () => ({
  subscribeToGroupMeta: (uid, h) => {
    mockEmit.groupHandlers.add(h);
    h.onReady?.();
    return () => mockEmit.groupHandlers.delete(h);
  },
}));

const { enableFreeze } = require('react-native-screens');
enableFreeze(true); // index.js does the same
const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
const { ChatStack } = require('../Code/ChatScreen/ChatNavigator');
const badgeStore = require('../Code/ChatScreen/chatBadgeStore');
const readBadges = () => {
  let value;
  const Probe = () => { value = badgeStore.useChatBadges(); return null; };
  let r;
  act(() => { r = ReactTestRenderer.create(<Probe />); });
  act(() => r.unmount());
  return value;
};

// native-stack only keeps the screen right under the focused one awake on
// Fabric (the new architecture this app runs on). It checks for this key at
// render time; set after the imports, which read it as an object.
global.nativeFabricUIManager = undefined;

const theme = { colors: { background: '#fff', text: '#000' } };
const reset = () => Object.keys(mockRenders).forEach((k) => { mockRenders[k] = 0; });

let unread = 0;
const dmMessage = (partnerId = 'friend') => {
  unread += 1;
  mockEmit.dmHandlers.forEach((h) => h.onUpsert?.({
    partnerId, chatId: `friend_me`, lastMessage: `hi ${unread}`, timestamp: unread, unreadCount: unread,
  }));
};
let groupSeq = 0;
const groupMessage = () => {
  groupSeq += 1;
  mockEmit.groupHandlers.forEach((h) => h.onUpsert?.({
    groupId: 'busy-group', groupName: 'Busy', lastMessage: `m${groupSeq}`,
    lastMessageTimestamp: groupSeq, unreadCount: groupSeq,
  }));
};

// One realtime event = one websocket frame = its own JS task, so each one is
// flushed by itself (React does not batch them together on the phone either).
// `gapMs` spaces the events out in (fake) time.
const each = async (n, fn, gapMs = 0) => {
  for (let i = 0; i < n; i += 1) {
    await act(async () => { fn(); jest.advanceTimersByTime(gapMs); });
  }
  // Let any throttled list flush land.
  await act(async () => { jest.advanceTimersByTime(2000); });
};

describe('chat stack redraws per realtime update', () => {
  let renderer;
  const nav = createNavigationContainerRef();

  beforeAll(async () => {
    jest.useFakeTimers();
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <NavigationContainer ref={nav}>
          <ChatStack selectedTheme={theme} setChatFocused={() => {}} modalVisibleChatinfo={false} setModalVisibleChatinfo={() => {}} />
        </NavigationContainer>,
      );
    });
    await act(async () => { jest.advanceTimersByTime(1000); });
  });

  afterAll(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  test('Inbox open: 50 DMs + 50 group messages', async () => {
    await act(async () => { nav.navigate('Inbox'); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, dmMessage);
    await each(50, groupMessage);
    console.log('[renders] Inbox open, 50 DMs + 50 group msgs:', JSON.stringify(mockRenders));
    // The public chat sits right under the Inbox and is not frozen on Fabric.
    expect(mockRenders.publicChat || 0).toBe(0);
  });

  test('DM open: 50 messages from another chat + 50 group messages', async () => {
    await act(async () => {
      nav.navigate('PrivateChat', { selectedUser: { senderId: 'friend', sender: 'Friend' } });
    });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, () => dmMessage('someone-else'));
    await each(50, groupMessage);
    console.log('[renders] DM open, 50 other DMs + 50 group msgs:', JSON.stringify(mockRenders));
    expect(mockRenders.dm || 0).toBe(0);
    expect(mockRenders.inbox || 0).toBe(0);
  });

  test('badges follow the realtime counts', async () => {
    // Last values sent: 'friend' / 'someone-else' share the running counter,
    // so the two chats sit at 50 and 100; the group at its latest count.
    expect(readBadges()).toEqual({ dm: 150, group: groupSeq });
    act(() => badgeStore.acknowledgeDmBadge());
    await each(1, () => dmMessage('friend'));
    expect(readBadges().dm).toBe(51); // friend went 50 -> 101: 51 new since the tap
  });

  test('Groups open: 50 group messages over 2.5 s redraw the list a few times, not 50', async () => {
    await act(async () => { nav.navigate('Groups'); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, groupMessage, 50);
    console.log('[renders] Groups open, 50 group msgs in 2.5 s:', JSON.stringify(mockRenders));
    expect(mockRenders.groups).toBeLessThanOrEqual(8);
    expect(mockLastGroups.value[0].lastMessage).toBe(`m${groupSeq}`);
  });
});
