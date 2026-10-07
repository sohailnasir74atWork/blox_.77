/**
 * birthdayMock.js — __DEV__-only stand-in for supabase/036_birthdays.sql, so
 * the Birthdays screens can be previewed on an emulator before 036 is live
 * (or while signed out). Same shapes and rules as the server; kept in memory.
 * The gift is stars (claim_birthday_gift); the mock never touches RTDB.
 *
 * `setPreview()` moves "your" birthday (today / soon / later), which is how
 * the dev panel on the Birthdays screen shows every Home card state.
 */

const PLAYERS = [
  { uid: 'm1', name: 'KitsuneHunter', avatar: null, offset: 0, wishes: 14 },
  { uid: 'm2', name: 'DragonTalonFan', avatar: null, offset: 0, wishes: 6 },
  { uid: 'm3', name: 'dough_master22', avatar: null, offset: 0, wishes: 2 },
  { uid: 'm4', name: 'ShadowTrader', avatar: null, offset: 1, wishes: 0 },
  { uid: 'm5', name: 'leopard_luna', avatar: null, offset: 3, wishes: 0 },
  { uid: 'm6', name: 'Sea_Beast_King', avatar: null, offset: 5, wishes: 0 },
  { uid: 'm7', name: 'BuddhaGrinder', avatar: null, offset: 6, wishes: 0 },
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
  wished: new Set(),
};

const fail = (msg) => { throw new Error(msg); };
const wait = (v) => new Promise((r) => setTimeout(() => r(v), 250));

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
    return wait({ wishes: p.wishes + 1 });
  },
};

export default mock;
