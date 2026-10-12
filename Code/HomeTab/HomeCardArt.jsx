/**
 * HomeCardArt — the picture at the start of a Home tab card: friendly art on
 * a white disc, so it reads on any bright card colour.
 *
 * Art from scripts/home-cards/make-art.mjs (a few KB each, @2x/@3x). Ported
 * from Adopt Me 2026-10-08; Blox uses the birthday set only.
 */

import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

const ART = {
  cake: require('../../assets/home-cards/cake.png'),
  balloons: require('../../assets/home-cards/balloons.png'),
  gift: require('../../assets/home-cards/gift.png'),
};

const HomeCardArt = ({ name }) => (
  <View style={styles.disc}>
    <Image resizeMethod="resize" source={ART[name]} style={styles.art} resizeMode="contain" />
  </View>
);

const styles = StyleSheet.create({
  disc: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', elevation: 3,
    shadowColor: '#1E1B4B', shadowOpacity: 0.22, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  art: { width: 46, height: 46 },
});

export default React.memo(HomeCardArt);
