/**
 * RoleBadges `compact` (chat rows + private-chat header): community and
 * custom badges are round icons with no text; the authority chip keeps its
 * label and comes last; the custom title keeps its text.
 */
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockGlobal = { user: { id: 'me' } };
jest.mock('../Code/GlobelStats', () => ({ useGlobalState: () => mockGlobal }));
const mockT = (k) => k;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-native-vector-icons/Ionicons', () => () => null);
jest.mock('../Code/Helper/UserDataCache', () => ({ getUserData: () => null }));
const mockProfile = {};
jest.mock('../Code/Helper/profileCache', () => ({ getCachedProfile: () => mockProfile }));
jest.mock('../Code/Helper/customBadges', () => ({
  useCustomBadges: () => {},
  customIdsOf: (cb) => Object.keys(cb || {}),
  resolveCustomBadge: (id, worn) => ({ id, name: `Custom ${id}`, image: null, color: worn?.color || '#EC4899' }),
}));

const RoleBadges = require('../Code/Design/componenets/RoleBadges').default;

const textsOf = (props) => {
  let tree;
  act(() => { tree = ReactTestRenderer.create(<RoleBadges userItem={{ id: 'u1' }} {...props} />); });
  return tree.root.findAllByType(Text).map((n) => [].concat(n.props.children).join(''));
};

const roles = {
  isModerator: true, isTrusted: true, isGrinder: true, isHelper: true,
  customTitle: 'Fruit King', customBadges: { b1: { color: '#2563EB' } },
};

test('full mode keeps every label', () => {
  expect(textsOf({ serverRoles: roles })).toEqual([
    'feed.role_badges.mod', 'Fruit King', 'feed.role_badges.trusted',
    'feed.role_badges.grinder', 'feed.role_badges.helper', 'Custom b1',
  ]);
});

test('compact mode: only the custom title and the authority chip (last) keep text', () => {
  expect(textsOf({ serverRoles: roles, compact: true })).toEqual(['Fruit King', 'feed.role_badges.mod']);
});

test('compact mode with community badges only draws no text at all', () => {
  expect(textsOf({ serverRoles: { isTrusted: true, isRaider: true }, compact: true })).toEqual([]);
});
