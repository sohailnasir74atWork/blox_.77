import React, { useRef, useMemo } from 'react';
import {
  FlatList,
  Image,
  View,
  Dimensions,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';

const { width, height } = Dimensions.get('window');

const ImageViewerScreen = ({ route }) => {
  const { images, initialIndex = 0 } = route.params;
  const listRef = useRef(null);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

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

  return (
    <FlatList
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
      viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
    />
  );
};

const styles = StyleSheet.create({
  slide: {
<<<<<<< HEAD
    width,
<<<<<<< HEAD
    height:'100%',
=======
    height,
>>>>>>> 7d3c677 (updated to api level 35 before)
=======
    // width,
    // height,
>>>>>>> 6ff4a10 (commit)
    justifyContent: 'center',
    alignItems: 'center',
    fkex:1
  },
  image: {
    width,
<<<<<<< HEAD
    height:'100%',
=======
    height,
>>>>>>> 7d3c677 (updated to api level 35 before)
    resizeMode: 'contain',
  },
});

export default ImageViewerScreen;
