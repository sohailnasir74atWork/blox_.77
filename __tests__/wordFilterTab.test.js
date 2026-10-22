// Admin Dashboard → Word filter tab: renders, lists, adds, tests text.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockRpc = jest.fn();
jest.mock('../Code/Supabase/client', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('../Code/Helper/MessageHelper', () => ({ showSuccessMessage: jest.fn(), showErrorMessage: jest.fn() }));
jest.mock('../Code/Helper/wordBlocklistCache', () => ({
  getRemoteWordList: () => null,
  refreshWordList: () => Promise.resolve(null),
}));
jest.mock('i18next', () => ({ t: (key) => key }));

const WordFilterTab = require('../Code/AppHelper/WordFilterTab').default;

const ROWS = [
  { id: 2, term: 'Xyzzy', key: 'xyzzy', kind: 'slur', mode: 'word', lang: 'en', note: 'test', active: true, addedBy: 'SR', addedByName: 'Zoro', updatedAt: new Date().toISOString() },
  { id: 1, term: 'marica', key: 'marica', kind: 'slur', mode: 'word', lang: 'es', note: 'seed (off)', active: false, addedBy: null, updatedAt: new Date().toISOString() },
];

const texts = (root) => root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
const press = (root, label) => {
  const btn = root.findAllByType(TouchableOpacity).find((b) => b.findAllByType(Text).some((t) => [].concat(t.props.children).join('') === label));
  if (!btn) throw new Error('no button ' + label);
  return act(async () => { await btn.props.onPress(); });
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('WordFilterTab', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockImplementation(async (name) => {
      if (name === 'word_filter_admin_list') return { data: { v: 5, rows: ROWS }, error: null };
      if (name === 'word_filter_add') return { data: {}, error: null };
      if (name === 'word_filter_check') return { data: 'slur', error: null };
      if (name === 'word_filter_hits_list') return { data: [], error: null };
      return { data: null, error: { message: 'unexpected ' + name } };
    });
  });

  it('lists terms, adds one, and tests text', async () => {
    let r;
    await act(async () => { r = TestRenderer.create(<WordFilterTab isDark={false} currentUser={{ displayName: 'Zoro' }} />); });
    await flush();
    const root = r.root;
    expect(texts(root)).toEqual(expect.arrayContaining(['Xyzzy', 'marica', 'ON', 'OFF', 'v5 · 1 on']));

    expect(texts(root)).toContain('Add a word'); // the add bar is always on top
    const termInput = root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Word or phrase');
    await act(async () => { termInput.props.onChangeText('Ｆ@ggy'); });
    expect(texts(root).some((t) => t.startsWith('offensive · matches as “faggy”'))).toBe(true);
    await press(root, 'Block');
    expect(mockRpc).toHaveBeenCalledWith('word_filter_add', expect.objectContaining({ p_term: 'Ｆ@ggy', p_kind: 'offensive', p_mode: 'auto', p_name: 'Zoro' }));

    await press(root, 'Test');
    const sample = root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Type any message or name');
    await act(async () => { sample.props.onChangeText('you n1gg3r'); });
    expect(texts(root)).toEqual(expect.arrayContaining(['slur: nigger', 'as a username: refused']));
    await press(root, 'Check on the server');
    expect(texts(root)).toContain('Server: slur');
    await act(async () => { r.unmount(); });
  });

  it('says when 049 is not applied', async () => {
    mockRpc.mockImplementation(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    let r;
    await act(async () => { r = TestRenderer.create(<WordFilterTab isDark />); });
    await flush();
    expect(texts(r.root).some((t) => t.includes('049_word_filter.sql has not been run'))).toBe(true);
    await act(async () => { r.unmount(); });
  });
});
