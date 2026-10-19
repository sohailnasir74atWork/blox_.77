import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Image, Text, TouchableOpacity } from 'react-native';

jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, o) => (o && o.defaultValue) || key, i18n: { language: 'en' } }),
}));

const StickerPicker = require('../Code/ChatScreen/Stickers/StickerPicker').default;
const { StickerImage } = require('../Code/ChatScreen/Stickers/StickerPicker');

const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn().mockRejectedValue(new Error('offline')); });
afterEach(() => { global.fetch = originalFetch; });

test('picker shows the bundled pack offline and sends the tapped sticker', async () => {
  const onSelect = jest.fn();
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<StickerPicker visible onClose={() => {}} onSelect={onSelect} isDark={false} />);
  });
  const images = tree.root.findAllByType(Image);
  expect(images).toHaveLength(16);
  expect(images[0].props.source.uri).toBe('https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/e1.png');
  expect(tree.root.findAllByType(Text).map((n) => n.props.children)).toEqual(
    expect.arrayContaining(['chat.stickers.title', 'Classic']),
  );

  const cell = tree.root.findAll((n) => n.type === TouchableOpacity && n.props.accessibilityLabel === 'chat.stickers.title');
  await ReactTestRenderer.act(async () => { cell[2].props.onPress(); });
  expect(onSelect).toHaveBeenCalledWith('https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/e3.png');
  expect(global.fetch).toHaveBeenCalledTimes(1); // opening the sheet checks the manifest
});

test('a message sticker renders only for a sticker-folder URL', async () => {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<StickerImage url="https://evil.example/x.png" label="Sent a sticker" />);
  });
  expect(tree.toJSON()).toBeNull();
  await ReactTestRenderer.act(async () => {
    tree.update(<StickerImage url="https://blox-api.b-cdn.net/stickers/fruits/dragon.webp" label="Sent a sticker" />);
  });
  const img = tree.root.findByType(Image);
  expect(img.props.source.uri).toBe('https://blox-api.b-cdn.net/stickers/fruits/dragon.webp');
  expect(img.props.accessibilityLabel).toBe('Sent a sticker');
});
