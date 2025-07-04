import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Linking,
} from 'react-native';
import { useLocalState } from '../LocalGlobelStats';
import { useGlobalState } from '../GlobelStats';

const APPS = [
    {
      id: 'adoptme',
      name: 'ADOPT ME Values',
      icon: require('../../assets/adoptme.png'),
      url: {
        ios: 'https://apps.apple.com/us/app/adoptme-values/id6745400111',
        android: 'https://play.google.com/store/apps/details?id=com.adoptmevaluescalc&hl=en',
      },
    },
    {
      id: 'mm2',
      name: 'MM2 Values',
      icon: require('../../assets/mm2.png'),
      url: {
        ios: 'https://apps.apple.com/app/id2345678901',
        android: 'https://play.google.com/store/apps/details?id=com.mm2tradesvalues',
      },
    },
    {
      id: 'gog',
      name: 'Grow a Garden',
      icon: require('../../assets/GAG.png'),
      url: {
        ios: 'https://apps.apple.com/app/id3456789012',
        android: 'https://play.google.com/store/apps/details?id=com.growagarden.gag',
      },
    },
    {
      id: 'bloxfruit',
      name: 'Blox Fruits Values',
      icon: require('../../assets/bloxfruit.png'),
      url: {
        ios: 'https://apps.apple.com/us/app/fruits-values-calculator/id6737775801',
        android: 'https://play.google.com/store/apps/details?id=com.bloxfruitevalues'
      },
    },
  ];

const MyAppAds = ({ currentAppId, mode = 'all' }) => {
  const { localState, updateLocalState } = useLocalState();
  const [rotatedAd, setRotatedAd] = useState(null);
  const {theme} = useGlobalState();
  const isDark = theme == 'dark'

  const filteredApps = APPS.filter((app) => app.id !== currentAppId);
  const styles = getStyles(isDark);


  useEffect(() => {
    if (mode === 'rotate') {
      const index = localState.adIndex ?? 0;
      const nextAd = filteredApps[index % filteredApps.length];
      setRotatedAd(nextAd);
      updateLocalState('adIndex', (index + 1) % filteredApps.length);
    }
  }, [mode, currentAppId]);

  const openStoreLink = (url) => {
    const storeUrl = Platform.OS === 'ios' ? url.ios : url.android;
    Linking.openURL(storeUrl).catch((err) =>
      console.error('❌ Failed to open store link:', err)
    );
  };

  const renderAd = (app, index, array) => (
    <View
      key={app.id}
      style={[
        styles.bannerContainer,
        index === array.length - 1 && { borderBottomWidth: 0 },
      ]}
    >
      <Image source={app.icon} style={styles.icon} />
      <View style={styles.textContainer}>
        <Text style={styles.title} numberOfLines={1}>{app.name}</Text>
        <Text style={styles.subtitle}>Try our other app</Text>
      </View>
      <TouchableOpacity
        style={styles.button}
        onPress={() => openStoreLink(app.url)}
      >
        <Text style={styles.buttonText}>Download Now</Text>
      </TouchableOpacity>
    </View>
  );
  

  return (
    <View>
      {mode === 'all'
        ? filteredApps.map((app, index, array) => renderAd(app, index, array))
        :  rotatedAd && renderAd(rotatedAd, 0, [rotatedAd])}
    </View>
  );
};

const getStyles = (isDark) =>
    StyleSheet.create({
      bannerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: isDark ? '#1e1e1e' : 'white',
        borderRadius: 10,
        paddingHorizontal: 10,
        height: 60,
        marginVertical: 2,
        borderBottomWidth: 1,
        borderBottomColor: isDark ? '#333333' : '#cccccc',
      },
      icon: {
        width: 40,
        height: 40,
        resizeMode: 'contain',
        borderRadius: 6,
        marginRight: 8,
      },
      textContainer: {
        flex: 1,
        justifyContent: 'center',
      },
      title: {
        fontSize: 13,
        fontFamily: 'Lato-Bold',
        color: isDark ? '#fff' : '#333',
      },
      subtitle: {
        fontSize: 10,
        color: isDark ? '#ccc' : '#666',
      },
      button: {
        backgroundColor: '#007BFF',
        paddingVertical: 6,
        paddingHorizontal: 15,
        borderRadius: 6,
        marginLeft: 8,
      },
      buttonText: {
        color: 'white',
        fontSize: 12,
        fontFamily: 'Lato-Bold',
      },
     
     
    });
  

export default MyAppAds;
