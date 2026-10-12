/**
 * birthdayMock.js — __DEV__-only stand-in for supabase/036_birthdays.sql, so
 * the Birthdays screens can be previewed on an emulator before 036 is live
 * (or while signed out). Same shapes and rules as the server; kept in memory.
 * The gift is stars (claim_birthday_gift); the mock never touches RTDB.
 *
 * `setPreview()` moves "your" birthday (today / soon / later), which is how
 * the dev panel on the Birthdays screen shows every Home card state.
 */

// `reason`: why 041 would rank them first ('dm' | 'group' | 'wished_you').
const PLAYERS = [
  { uid: 'm1', name: 'KitsuneHunter', avatar: null, offset: 0, wishes: 14, reason: 'dm' },
  { uid: 'm2', name: 'DragonTalonFan', avatar: null, offset: 0, wishes: 6, reason: 'group' },
  { uid: 'm3', name: 'dough_master22', avatar: null, offset: 0, wishes: 2, reason: 'wished_you' },
  { uid: 'm4', name: 'ShadowTrader', avatar: null, offset: 1, wishes: 0 },
  { uid: 'm5', name: 'leopard_luna', avatar: null, offset: 3, wishes: 0 },
  { uid: 'm6', name: 'Sea_Beast_King', avatar: null, offset: 5, wishes: 0 },
  { uid: 'm7', name: 'BuddhaGrinder', avatar: null, offset: 6, wishes: 0 },
  // Enough for "Load more" (037 pages of 20).
  ...['Dragon', 'Kitsune', 'Leopard', 'Dough', 'Venom', 'Spirit', 'Shadow', 'Control', 'Portal', 'Buddha',
    'Phoenix', 'Rumble', 'Magma', 'Ice', 'Light', 'Quake', 'Sound', 'Gravity',
    'Mammoth', 'TRex', 'Yeti', 'Gas', 'Blizzard', 'Pain'].map((n, i) => ({
    uid: `g${i}`, name: `${n}Main${i}`, avatar: null, offset: i < 18 ? 0 : 1, wishes: i % 5,
  })),
];

const RECEIVED = [
  { name: 'KitsuneHunter', avatar: null, template: 'hbd' },
  { name: 'DragonTalonFan', avatar: null, template: 'party' },
  { name: 'BuddhaGrinder', avatar: null, template: 'pets' },
  { name: 'dough_master22', avatar: null, template: 'cake' },
  { name: 'Sea_Beast_King', avatar: null, template: 'hbd' },
];

const monthDayIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return { month: d.getMonth() + 1, day: d.getDate() };
};

const OFFSETS = { today: 0, soon: 3, later: 60 };

const state = {
  preview: 'today',
  show: true,          // shown by default
  edited: null,        // { month, day } after the one correction
  asked: false,
  giftOpened: false,
  thanked: false,
  wished: new Set(),
};

const RANK = { dm: 4, group: 2, wished_you: 1 };

const fail = (msg) => { throw new Error(msg); };
const wait = (v, ms = 250) => new Promise((r) => setTimeout(() => r(v), ms));

const mine = () => {
  const { month, day } = state.edited || monthDayIn(OFFSETS[state.preview] ?? 0);
  const today = state.preview === 'today';
  return {
    month,
    day,
    show: state.show,
    asked: state.asked,
    minor: false,
    giftReady: today && !state.giftOpened,
    giftOpened: today && state.giftOpened,
    wishCount: today ? RECEIVED.length : 0,
    thankPending: today && !state.thanked ? RECEIVED.length : 0,
    wishes: today ? RECEIVED : [],
    canEdit: !state.edited,
  };
};

const mock = {
  /** 'today' | 'soon' | 'later' */
  setPreview(which) {
    state.preview = which;
    state.asked = false;
    state.giftOpened = false;
    state.thanked = false;
    state.edited = null;
  },
  getPreview: () => state.preview,

  /** The stars gift: once, on the day. */
  async claim_birthday_gift() {
    if (state.preview !== 'today' || state.giftOpened) fail('birthday gift not available');
    state.giftOpened = true;
    return wait({ stars: 15 });
  },

  async get_my_birthday() {
    return wait(mine());
  },

  async birthday_home() {
    return wait({
      ...mine(),
      today: PLAYERS.filter((p) => p.offset <= 1).map((p) => {
        const { month, day } = monthDayIn(p.offset);
        return [p.uid, month, day];
      }),
    });
  },

  async set_birthday_visibility({ p_show }) {
    state.show = !!p_show;
    state.asked = true;
    return wait({ show: state.show, asked: true });
  },

  async list_birthdays({ p_days }) {
    const rows = PLAYERS
      .filter((p) => p.offset <= (p_days ?? 7))
      .map((p) => ({
        uid: p.uid,
        name: p.name,
        avatar: p.avatar,
        ...monthDayIn(p.offset),
        wishes: p.wishes + (state.wished.has(p.uid) ? 1 : 0),
        wished: state.wished.has(p.uid),
      }));
    return wait(rows);
  },

  // 037: today .. today + p_days, PAGE of p_limit after p_cursor (an index here).
  async list_birthdays_page({ p_days = 1, p_limit = 20, p_cursor = null }) {
    const all = PLAYERS.filter((p) => p.offset <= p_days).sort((a, b) => a.offset - b.offset);
    const start = typeof p_cursor === 'number' ? p_cursor : 0;
    const rows = all.slice(start, start + p_limit).map((p) => ({
      uid: p.uid,
      name: p.name,
      avatar: p.avatar,
      ...monthDayIn(p.offset),
      until: p.offset,
      wishes: p.wishes + (state.wished.has(p.uid) ? 1 : 0),
      wished: state.wished.has(p.uid),
    }));
    const end = start + p_limit;
    return wait({
      rows,
      next: end < all.length ? end : null,
      counts: start ? null : Array.from({ length: p_days + 1 }, (_, d) => all.filter((p) => p.offset === d).length),
    }, 700);
  },

  // 041: today's top p_limit, people you know first, plus the day's counts.
  async list_birthdays_top({ p_limit = 6 }) {
    const today = PLAYERS.filter((p) => p.offset === 0)
      .sort((a, b) => (RANK[b.reason] || 0) - (RANK[a.reason] || 0));
    const rows = today.slice(0, p_limit).map((p) => ({
      uid: p.uid,
      name: p.name,
      avatar: p.avatar,
      ...monthDayIn(0),
      until: 0,
      wishes: p.wishes + (state.wished.has(p.uid) ? 1 : 0),
      wished: state.wished.has(p.uid),
      reason: p.reason || null,
    }));
    return wait({
      rows,
      total: today.length,
      unwished: today.filter((p) => !state.wished.has(p.uid)).length,
      tomorrow: PLAYERS.filter((p) => p.offset === 1).length,
    }, 500);
  },

  async wish_all_birthdays() {
    const todo = PLAYERS.filter((p) => p.offset === 0 && !state.wished.has(p.uid));
    todo.forEach((p) => state.wished.add(p.uid));
    return wait({ sent: todo.length, left: 0, limited: false }, 900);
  },

  async thank_birthday_wishers() {
    if (state.preview !== 'today') fail('not their birthday');
    const n = state.thanked ? 0 : RECEIVED.length;
    state.thanked = true;
    return wait({ thanked: n }, 600);
  },

  async update_my_birthday({ year, month, day }) {
    if (state.edited) fail('already_edited');
    state.edited = { month, day };
    const y = year || new Date().getFullYear() - 20;
    return wait({ dateOfBirth: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
  },

  async get_public_birthday({ p_uid }) {
    const p = PLAYERS.find((x) => x.uid === p_uid);
    return wait(p ? monthDayIn(p.offset) : null);
  },

  async send_birthday_wish({ p_to }) {
    const p = PLAYERS.find((x) => x.uid === p_to);
    if (!p) fail('cannot wish this player');
    if (p.offset !== 0) fail('not their birthday');
    if (state.wished.has(p_to)) fail('already wished');
    state.wished.add(p_to);
    return wait({ wishes: p.wishes + 1 }, 600);
  },
};

export default mock;
