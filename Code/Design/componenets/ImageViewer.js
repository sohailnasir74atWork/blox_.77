import React, { useRef, useMemo, useState, useCallback } from 'react';
import {
  FlatList,
  Image,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  StyleSheet,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../../GlobelStats';
import { canSaveToGallery, saveImageToGallery } from '../../Helper/saveImageToGallery';
import { showErrorMessage, showSuccessMessage } from '../../Helper/MessageHelper';
import { trackGrowthEvent } from '../../Helper/growthAnalytics';

const { width, height } = Dimensions.get('window');

const ImageViewerScreen = ({ route }) => {
  const { images, initialIndex = 0 } = route.params;
  const listRef = useRef(null);
  const { theme } = useGlobalState();
  const insets = useSafeAreaInsets();
  const isDarkMode = theme === 'dark';
  const [index, setIndex] = useState(initialIndex);
  const [saving, setSaving] = useState(false);

  const backgroundColor = isDarkMode ? '#000' : '#fff';

  const renderItem = useMemo(
    () => ({ item }) => (
      <View style={[styles.slide, { backgroundColor }]}>
        <Image source={{ uri: item }} style={styles.image} />
      </View>
    ),
    [backgroundColor]
  );

  const keyExtractor = useMemo(
    () => (_, index) => index.toString(),
    []
  );

  const onMomentumScrollEnd = useCallback((e) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }, []);

  const handleSave = useCallback(async () => {
    const url = images?.[index];
    if (!url || saving) return;
    setSaving(true);
    try {
      if (!(await canSaveToGallery())) {
        showErrorMessage('Error', 'Allow storage access to save images.');
        return;
      }
      await saveImageToGallery(url);
      trackGrowthEvent('feed_image_save', { source: 'viewer', count: 1 });
      showSuccessMessage('Saved', 'Image saved to your gallery.');
    } catch (e) {
      showErrorMessage('Error', 'Could not save the image. Try again.');
    } finally {
      setSaving(false);
    }
  }, [images, index, saving]);

  return (
    <View style={{ flex: 1, backgroundColor }}>
      <FlatList
        removeClippedSubviews={false}
        ref={listRef}
        data={images}
        horizontal
        pagingEnabled
        initialScrollIndex={initialIndex}
        getItemLayout={(data, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        initialNumToRender={3}
        showsHorizontalScrollIndicator={false}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onMomentumScrollEnd={onMomentumScrollEnd}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
      />

      <View style={[styles.bottomBar, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {images?.length > 1 && (
          <View style={styles.counter}>
            <Text style={styles.counterText}>{index + 1} / {images.length}</Text>
          </View>
        )}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.8} disabled={saving}>
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="download-outline" size={18} color="#fff" />}
          <Text style={styles.saveText}>Save image</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  slide: {
    width,
    height:'100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width,
    height:'100%',
    resizeMode: 'contain',
  },
  bottomBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  saveBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  saveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
});

export default ImageViewerScreen;
