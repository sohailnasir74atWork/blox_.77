/**
 * EvidenceViewer.jsx — full-screen look at the screenshots attached to a
 * moderation action, one at a time. Ported from adoptme-jan7 (19b6cde).
 *
 * Opened from a thumbnail in the moderation history (ModHistoryList) and the
 * Mod Log. Plain Modal + Image with prev/next: there are at most three
 * images. A missing image says so on screen instead of leaving an empty
 * frame that reads as a loading bug.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet, Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const EvidenceViewer = ({ visible, urls = [], startIndex = 0, onClose }) => {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const [index, setIndex] = useState(startIndex);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Re-entering on a different thumbnail lands on that image.
  useEffect(() => {
    if (visible) {
      setIndex(Math.min(Math.max(0, startIndex), Math.max(0, list.length - 1)));
      setLoading(true);
      setFailed(false);
    }
  }, [visible, startIndex, list.length]);

  const go = useCallback((delta) => {
    setIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= list.length) return prev;
      setLoading(true);
      setFailed(false);
      return next;
    });
  }, [list.length]);

  if (!visible || list.length === 0) return null;

  const url = list[index];
  const atFirst = index === 0;
  const atLast = index === list.length - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.topBar}>
          <Text style={styles.counter}>Screenshot {index + 1} of {list.length}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.stage}>
          {loading && !failed && (
            <ActivityIndicator size="large" color="#fff" style={StyleSheet.absoluteFill} />
          )}
          {failed ? (
            <View style={styles.failBox}>
              <Icon name="image-outline" size={44} color="#9ca3af" />
              <Text style={styles.failTitle}>Screenshot unavailable</Text>
              <Text style={styles.failBody}>
                It could not be loaded. It may have been removed from storage, or the device is offline.
              </Text>
            </View>
          ) : (
            <Image
              source={{ uri: url }}
              style={styles.image}
              resizeMode="contain"
              onLoadEnd={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true); }}
            />
          )}
        </View>

        {list.length > 1 && (
          <View style={styles.nav}>
            <TouchableOpacity onPress={() => go(-1)} disabled={atFirst} style={[styles.navBtn, atFirst && styles.navBtnOff]}>
              <Icon name="chevron-back" size={22} color="#fff" />
              <Text style={styles.navText}>Prev</Text>
            </TouchableOpacity>
            <View style={styles.dots}>
              {list.map((_, i) => (
                <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
              ))}
            </View>
            <TouchableOpacity onPress={() => go(1)} disabled={atLast} style={[styles.navBtn, atLast && styles.navBtnOff]}>
              <Text style={styles.navText}>Next</Text>
              <Icon name="chevron-forward" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 54, paddingBottom: 12,
  },
  counter: { color: '#fff', fontSize: 15, fontWeight: '700' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: SCREEN_W, height: SCREEN_H * 0.7 },
  failBox: { alignItems: 'center', paddingHorizontal: 40 },
  failTitle: { color: '#e5e7eb', fontSize: 16, fontWeight: '700', marginTop: 12 },
  failBody: { color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 46, paddingTop: 8,
  },
  navBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10,
  },
  navBtnOff: { opacity: 0.3 },
  navText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { backgroundColor: '#fff' },
});

export default EvidenceViewer;
