// Roles reads before supabase/045 is applied (is_helper + custom_title
// missing): one retry with the older column list, then that list for the rest
// of the session, so role badges keep working.

const selects = [];
let has045 = false;
const result = (cols) => (!has045 && /is_helper|custom_title/.test(cols)
  ? { data: null, error: { code: '42703', message: 'column user_roles.is_helper does not exist' } }
  : { data: cols.includes('uid') ? [{ uid: 'u1', is_trusted: true, is_helper: true, custom_title: 'Host' }] : null, error: null });

jest.mock('../Code/Supabase/client', () => ({
  supabase: {
    from: () => ({
      select: (cols) => {
        selects.push(cols);
        return {
          in: async () => result(cols),
          eq: () => ({ maybeSingle: async () => { const r = result(cols); return { ...r, data: r.data?.[0] ?? null }; } }),
        };
      },
    }),
  },
}));

beforeEach(() => { selects.length = 0; jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { console.warn.mockRestore(); });

test('with 045 applied: one select, Helper and title mapped', async () => {
  has045 = true;
  let backend;
  jest.isolateModules(() => { backend = require('../Code/Supabase/userBackend'); });
  const roles = await backend.getRoles('u1');
  expect(selects).toHaveLength(1);
  expect(roles).toMatchObject({ isTrusted: true, isHelper: true, customTitle: 'Host' });
});

test('without 045: retries once with the old columns, then keeps using them', async () => {
  has045 = false;
  let backend;
  jest.isolateModules(() => { backend = require('../Code/Supabase/userBackend'); });
  const roles = await backend.getRoles('u1');
  expect(selects).toHaveLength(2);
  expect(selects[1]).not.toMatch(/is_helper|custom_title/);
  expect(roles).toMatchObject({ isTrusted: true });

  selects.length = 0;
  const batch = await backend.getRolesBatch(['u1', 'u2']);
  expect(selects).toHaveLength(1); // already on the old list
  expect(selects[0]).not.toMatch(/is_helper/);
  expect(batch.get('u1')).toMatchObject({ isTrusted: true });
});

test('without 045, batch first: the chunk is retried, not dropped', async () => {
  has045 = false;
  let backend;
  jest.isolateModules(() => { backend = require('../Code/Supabase/userBackend'); });
  const batch = await backend.getRolesBatch(['u1']);
  expect(selects).toHaveLength(2);
  expect(batch.get('u1')).toMatchObject({ isTrusted: true });
});
