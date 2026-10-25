/**
 * The Roblox name on a new trade (Code/Helper/robloxIdentity.js): a verified
 * player can only post under the verified name stored on users/{uid}, never
 * under what is typed in the form; unverified players keep the typed name.
 */
jest.mock('@react-native-firebase/database', () => ({
  ref: jest.fn((db, path) => path),
  get: jest.fn(),
}));

import { get } from '@react-native-firebase/database';
import { verifiedRobloxName, readVerifiedRobloxName, robloxFieldsForTrade } from '../Code/Helper/robloxIdentity';

const snap = (v) => ({ val: () => v });
const stored = (leaves) => get.mockImplementation((path) => {
  const leaf = path.split('/').pop();
  return Promise.resolve(snap(leaf in leaves ? leaves[leaf] : null));
});

describe('verifiedRobloxName', () => {
  test('returns the trimmed name only when verified is exactly true', () => {
    expect(verifiedRobloxName({ robloxUsername: ' Bob ', robloxUsernameVerified: true })).toBe('Bob');
    expect(verifiedRobloxName({ robloxUsername: 'Bob', robloxUsernameVerified: false })).toBeNull();
    expect(verifiedRobloxName({ robloxUsername: 'Bob', robloxUsernameVerified: 'true' })).toBeNull();
    expect(verifiedRobloxName({ robloxUsername: '  ', robloxUsernameVerified: true })).toBeNull();
    expect(verifiedRobloxName({ robloxUsernameVerified: true })).toBeNull();
    expect(verifiedRobloxName(null)).toBeNull();
  });
});

describe('readVerifiedRobloxName', () => {
  beforeEach(() => get.mockReset());

  test('the stored record wins over a stale in-memory profile', async () => {
    stored({ robloxUsername: 'RealName', robloxUsernameVerified: true });
    await expect(readVerifiedRobloxName({}, 'u1', { robloxUsername: 'Old', robloxUsernameVerified: false })).resolves.toBe('RealName');
    expect(get).toHaveBeenCalledWith('users/u1/robloxUsername');
    expect(get).toHaveBeenCalledWith('users/u1/robloxUsernameVerified');
  });

  test('stored record not verified → null even if memory says verified', async () => {
    stored({ robloxUsername: 'Typed', robloxUsernameVerified: false });
    await expect(readVerifiedRobloxName({}, 'u1', { robloxUsername: 'Old', robloxUsernameVerified: true })).resolves.toBeNull();
  });

  test('read fails → falls back to the in-memory record', async () => {
    get.mockRejectedValue(new Error('offline'));
    await expect(readVerifiedRobloxName({}, 'u1', { robloxUsername: 'Mem', robloxUsernameVerified: true })).resolves.toBe('Mem');
  });

  test('no db or uid → in-memory record, no read', async () => {
    await expect(readVerifiedRobloxName(null, 'u1', { robloxUsername: 'Mem', robloxUsernameVerified: true })).resolves.toBe('Mem');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('robloxFieldsForTrade', () => {
  test('verified: the verified name, whatever was typed', () => {
    expect(robloxFieldsForTrade('RealName', 'SomeoneElse')).toEqual({ robloxUsername: 'RealName', robloxUsernameVerified: true });
  });

  test('unverified: the typed name, never marked verified', () => {
    expect(robloxFieldsForTrade(null, ' Typed ')).toEqual({ robloxUsername: 'Typed', robloxUsernameVerified: false });
    expect(robloxFieldsForTrade(null, undefined)).toEqual({ robloxUsername: '', robloxUsernameVerified: false });
  });
});
