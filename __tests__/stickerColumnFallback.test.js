// A build that reaches users before supabase/050_stickers.sql is applied must
// keep DMs and groups working (without stickers). Fake PostgREST below answers
// like a database with or without 050.

const mockDb = { has050: false, hasOrigin: true, calls: [] };

const PGRST_UNKNOWN_BODY_COLUMN = (col, table) =>
  ({ code: 'PGRST204', message: `Could not find the '${col}' column of '${table}' in the schema cache` });
const PG_UNKNOWN_COLUMN = (col, table) =>
  ({ code: '42703', message: `column ${table}.${col} does not exist` });

function mockAnswer(call) {
  const { table, op, cols, payload, fn } = call;
  if (op === 'rpc') {
    if (fn === 'send_group_sticker' && !mockDb.has050) {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.send_group_sticker' } };
    }
    return { data: { id: 'g1', group_id: 'G', sender_id: 'U1', text: call.args.p_text ?? null, gif: call.args.p_gif ?? null }, error: null };
  }
  if (op === 'insert') {
    if (!mockDb.has050 && 'gif' in payload) return { data: null, error: PGRST_UNKNOWN_BODY_COLUMN('gif', table) };
    if (!mockDb.hasOrigin && 'origin' in payload) return { data: null, error: PGRST_UNKNOWN_BODY_COLUMN('origin', table) };
  }
  if (!mockDb.has050 && cols && cols.split(', ').includes('gif')) {
    return { data: null, error: PG_UNKNOWN_COLUMN('gif', table) };
  }
  const row = { id: 'r1', chat_id: 'A_B', sender_id: 'A', recipient_id: 'B', text: 'hi', created_at: '2026-10-19T00:00:00Z' };
  if (cols && cols.split(', ').includes('gif')) row.gif = payload?.gif ?? null;
  return { data: op === 'insert' ? row : [row], error: null };
}

jest.mock('../Code/Supabase/client', () => {
  const builder = (table) => {
    const call = { table, op: 'select', cols: null, payload: null };
    const b = {
      select(cols) { call.cols = cols; return b; },
      insert(p) { call.op = 'insert'; call.payload = p; return b; },
      eq() { return b; }, order() { return b; }, limit() { return b; },
      or() { return b; }, gte() { return b; }, single() { return b; }, maybeSingle() { return b; },
      then(resolve, reject) {
        mockDb.calls.push(call);
        return Promise.resolve(mockAnswer(call)).then(resolve, reject);
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => builder(table),
      rpc: (fn, args) => {
        const call = { op: 'rpc', fn, args };
        mockDb.calls.push(call);
        return Promise.resolve(mockAnswer(call));
      },
    },
  };
});

let pm, gm, support, reports;
beforeEach(() => {
  jest.resetModules();
  mockDb.has050 = false;
  mockDb.hasOrigin = true;
  mockDb.calls = [];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  pm = require('../Code/Supabase/privateMessagesBackend');
  gm = require('../Code/Supabase/groupMessagesBackend');
  support = require('../Code/Supabase/stickerSupport');
  reports = require('../Code/Supabase/messageReports');
});
afterEach(() => console.warn.mockRestore());

const hasGif = (cols) => cols.split(', ').includes('gif');
const STICKER = 'https://blox-api.b-cdn.net/stickers/fruits/dragon.webp';

describe('before 050', () => {
  test('DM history still loads, then reads skip gif for the session', async () => {
    const listener = jest.fn();
    support.subscribeStickerSupport(listener);

    const rows = await pm.loadPrivateMessages('A_B');
    expect(rows).toHaveLength(1);
    expect(rows[0].gif).toBeNull();
    expect(mockDb.calls.map((c) => hasGif(c.cols))).toEqual([true, false]);
    expect(support.stickersSupported('private_messages')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    mockDb.calls = [];
    expect(await pm.loadPrivateMessagesSince('A_B', { createdAt: 'x', id: 'y' })).toHaveLength(1);
    expect(mockDb.calls.map((c) => hasGif(c.cols))).toEqual([false]);
  });

  test('a DM text send still lands (one retry without gif)', async () => {
    const msg = await pm.sendPrivateMessage({ chatId: 'A_B', senderId: 'A', recipientId: 'B', text: 'hi' });
    expect(msg.text).toBe('hi');
    expect(mockDb.calls).toHaveLength(2);
    expect(mockDb.calls.every((c) => !('gif' in c.payload))).toBe(true);
    expect(hasGif(mockDb.calls[1].cols)).toBe(false);
  });

  test('a DM sticker send fails as NOT_ALLOWED and turns stickers off', async () => {
    const send = () => pm.sendPrivateMessage({ chatId: 'A_B', senderId: 'A', recipientId: 'B', gif: STICKER });
    const err = await send().catch((e) => e);
    expect(err.message).toBe('STICKER_NOT_ALLOWED');
    expect(reports.chatErrorCode(err)).toBe('NOT_ALLOWED');
    expect(support.stickersSupported('private_messages')).toBe(false);

    mockDb.calls = [];
    await expect(send()).rejects.toThrow('STICKER_NOT_ALLOWED');
    expect(mockDb.calls).toHaveLength(0); // no request once known unsupported
  });

  test('missing origin AND gif: the send retries past both', async () => {
    mockDb.hasOrigin = false;
    const msg = await pm.sendPrivateMessage({ chatId: 'A_B', senderId: 'A', recipientId: 'B', text: 'hi', origin: 'trade' });
    expect(msg.text).toBe('hi');
    expect(mockDb.calls).toHaveLength(3);
    const last = mockDb.calls[2];
    expect('origin' in last.payload).toBe(false);
    expect(hasGif(last.cols)).toBe(false);
  });

  test('group history loads in all three reads', async () => {
    expect(await gm.loadGroupMessages('G')).toHaveLength(1);
    expect(support.stickersSupported('group_messages')).toBe(false);
    expect(support.stickersSupported('private_messages')).toBe(true); // per table
    mockDb.calls = [];
    expect(await gm.loadGroupMessagesBetween('G', { fromCreatedAt: 'x' })).toHaveLength(1);
    expect((await gm.loadGroupMessagesSince('G', { createdAt: 'x', id: 'y' })).rows).toHaveLength(1);
    expect(mockDb.calls.map((c) => hasGif(c.cols))).toEqual([false, false]);
  });

  test('a group sticker send (rpc missing) fails as NOT_ALLOWED; text sends are unaffected', async () => {
    const err = await gm.sendGroupMessage({ groupId: 'G', senderId: 'U1', message: { gif: STICKER } }).catch((e) => e);
    expect(err.message).toBe('STICKER_NOT_ALLOWED');
    expect(support.stickersSupported('group_messages')).toBe(false);
    const msg = await gm.sendGroupMessage({ groupId: 'G', senderId: 'U1', message: { text: 'hi' } });
    expect(msg.text).toBe('hi');
    expect(mockDb.calls.map((c) => c.fn)).toEqual(['send_group_sticker', 'send_group_message']);
  });
});

describe('with 050', () => {
  beforeEach(() => { mockDb.has050 = true; });

  test('reads and sends carry gif in one request each', async () => {
    await pm.loadPrivateMessages('A_B');
    const msg = await pm.sendPrivateMessage({ chatId: 'A_B', senderId: 'A', recipientId: 'B', gif: STICKER });
    expect(msg.gif).toBe(STICKER);
    expect(mockDb.calls).toHaveLength(2);
    expect(mockDb.calls.every((c) => hasGif(c.cols))).toBe(true);
    expect(mockDb.calls[1].payload.gif).toBe(STICKER);

    const g = await gm.sendGroupMessage({ groupId: 'G', senderId: 'U1', message: { gif: STICKER } });
    expect(g.gif).toBe(STICKER);
    expect(support.stickersSupported('private_messages')).toBe(true);
    expect(support.stickersSupported('group_messages')).toBe(true);
  });

  test('text DMs never send a gif key', async () => {
    await pm.sendPrivateMessage({ chatId: 'A_B', senderId: 'A', recipientId: 'B', text: 'hi' });
    expect('gif' in mockDb.calls[0].payload).toBe(false);
  });
});

test('withoutGifColumn drops only gif', () => {
  expect(support.withoutGifColumn('id, text, image_url, gif, fruits')).toBe('id, text, image_url, fruits');
});
