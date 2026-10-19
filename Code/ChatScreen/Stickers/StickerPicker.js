// Sticker sheet shared by public, group and private chat: one tab per pack
// from the remote manifest (stickerManifest.js), a grid of stickers below.
// onSelect(url) gets the sticker URL; the caller sends it and closes the sheet.
import React, { memo, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, FlatList, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getStickerPacks,
  subscribeStickerPacks,
  refreshStickerManifest,
  stickerPackName,
  isAllowedStickerUrl,
} from './stickerManifest';
import { stickersSupported, subscribeStickerSupport } from '../../Supabase/stickerSupport';

const COLUMNS = 4;

const StickerPicker = ({ visible, onClose, onSelect, isDark }) => {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [packs, setPacks] = useState(getStickerPacks);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => subscribeStickerPacks(setPacks), []);
  useEffect(() => {
    if (visible) refreshStickerManifest();
  }, [visible]);

  const active = packs.find((p) => p.id === activeId) || packs[0];
  const text = isDark ? '#FFF' : '#000';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { backgroundColor: isDark ? '#2C2C2C' : '#FFF', paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: text }]}>{t('chat.stickers.title')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={24} color={text} />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {packs.map((pack) => {
              const selected = pack.id === active?.id;
              return (
                <TouchableOpacity
                  key={pack.id}
                  onPress={() => setActiveId(pack.id)}
                  style={[
                    styles.tab,
                    { backgroundColor: selected ? '#1E88E5' : (isDark ? '#3A3A3A' : '#EEE') },
                  ]}
                >
                  <Text style={[styles.tabText, { color: selected ? '#FFF' : text }]} numberOfLines={1}>
                    {stickerPackName(pack, t, i18n.language)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <FlatList
            key={active?.id}
            data={active ? active.stickers : []}
            keyExtractor={(item) => item.url}
            numColumns={COLUMNS}
            style={styles.grid}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.cell}
                onPress={() => onSelect(item.url)}
                accessibilityLabel={t('chat.stickers.title')}
              >
                <Image resizeMethod="resize" source={{ uri: item.url }} style={styles.sticker} />
              </TouchableOpacity>
            )}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// False once the database turned out to lack 050's sticker column / rpc for
// `table` ('private_messages' | 'group_messages'); the input hides its button.
export function useStickersSupported(table) {
  const [ok, setOk] = useState(() => stickersSupported(table));
  useEffect(() => {
    setOk(stickersSupported(table));
    return subscribeStickerSupport(() => setOk(stickersSupported(table)));
  }, [table]);
  return ok;
}

// A sticker inside a message bubble. Renders nothing for a URL outside the
// sticker folders (the server refuses those since 050; this covers old rows).
export const StickerImage = memo(function StickerImage({ url, label }) {
  if (!isAllowedStickerUrl(url)) return null;
  return (
    <View style={styles.inBubble}>
      <Image resizeMethod="resize" source={{ uri: url }} style={styles.bubbleSticker} accessibilityLabel={label} />
    </View>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    paddingTop: 16,
    paddingHorizontal: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  tabs: {
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    maxWidth: 140,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  grid: {
    maxHeight: 320,
  },
  cell: {
    width: `${100 / COLUMNS}%`,
    aspectRatio: 1,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sticker: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  inBubble: {
    marginBottom: 4,
  },
  bubbleSticker: {
    width: 50,
    height: 50,
    resizeMode: 'contain',
  },
});

export default StickerPicker;
