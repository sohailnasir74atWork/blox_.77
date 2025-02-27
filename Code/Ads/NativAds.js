import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Image, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeAd, NativeAdView, TestIds, NativeAsset } from 'react-native-google-mobile-ads';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import getAdUnitId from './ads';

const bannerAdUnitId = getAdUnitId('native'); // Test Ad Unit

const MyNativeAdComponent = () => {
  const [nativeAd, setNativeAd] = useState(null);
  const [loading, setLoading] = useState(true);
  const {theme} = useGlobalState()

  const isDarkMode = theme === 'dark'
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);



  useEffect(() => {
    let isMounted = true;

    NativeAd.createForAdRequest(bannerAdUnitId)
      .then((ad) => {
        if (isMounted) {
          setNativeAd(ad);
          setLoading(false);
        }
      })
      .catch((error) => {
        console.error('Failed to load native ad:', error);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
      </View>
    );
  }

  if (!nativeAd) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>No ad available</Text>
      </View>
    );
  }
console.log(nativeAd)
  return (
    <View style={styles.adContainermain}>
    <NativeAdView nativeAd={nativeAd} style={styles.adContainer}>
      {nativeAd.icon?.url ? (
        <Image source={{ uri: nativeAd.icon.url }} style={styles.adIcon} resizeMode="contain" />
      ) : (
        <Image source={{ uri: "https://bloxfruitscalc.com/wp-content/uploads/2024/09/Blade_Icon.webp" }} style={styles.adIcon} resizeMode="contain" />
      )}

      <View style={styles.adContent}>
        {nativeAd.advertiser && <Text style={styles.adAdvertiser}>{nativeAd.advertiser}</Text>}

        {nativeAd.headline && <Text style={styles.adHeadline}>{nativeAd.headline || 'Sponsored Ad'}</Text>}


        {nativeAd.body && <Text style={styles.adBody}>{nativeAd.body}</Text>}

        {(nativeAd.price || nativeAd.store) && (
          <Text style={styles.adPriceStore}>
            {nativeAd.price ? nativeAd.price : ''} {nativeAd.price && nativeAd.store ? '•' : ''} {nativeAd.store ? nativeAd.store : ''}
          </Text>
        )}

        {nativeAd.starRating && nativeAd.starRating > 0 && (
          <Text style={styles.adStarRating}>⭐ {nativeAd.starRating}/5</Text>
        )}

          {nativeAd.callToAction && <TouchableOpacity style={styles.adButton}>
            <Text style={styles.adButtonText}>{nativeAd.callToAction || 'Learn More'}</Text>
          </TouchableOpacity>}
      </View>
    </NativeAdView>
    </View>
  );
};

const getStyles = (isDarkMode) =>
StyleSheet.create({
    adContainermain: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        borderRadius: 12,
        backgroundColor: isDarkMode ? config.colors.primary : 'white',
        marginBottom: 10,
        padding: 12,
},
  adContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    // borderRadius: 12,
    // backgroundColor: isDarkMode ? config.colors.primary : 'white',
    // marginBottom: 10,
    // padding: 12,
  },
  adIcon: {
    width: 50,
    height: 50,
    borderRadius: 10,
    marginRight: 12,
  },
  placeholderIcon: {
    width: 50,
    height: 50,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    marginRight: 12,
  },
  adContent: {
    flex: 1,
  },
  adAdvertiser: {
    fontSize: 10,
    color: isDarkMode ? 'white' : 'black',
    fontFamily: 'Lato-Regular',
  },
  adHeadline: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? 'white' : 'black',
  },
  adBody: {
    fontSize: 12,
    color: isDarkMode ? 'white' : 'black',
    marginVertical: 4,
    fontFamily: 'Lato-Regular',
  },
  adPriceStore: {
    fontSize: 12,
    color: isDarkMode ? 'white' : 'black',
    marginTop: 2,
    fontFamily: 'Lato-Regular',
  },
  adStarRating: {
    fontSize: 12,
    color: '#FFD700', // Gold color for stars
    marginTop: 2,
    fontFamily: 'Lato-Regular',
  },
  adButton: {
    backgroundColor: config.colors.hasBlockGreen,
    paddingVertical: 1,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginVertical: 6,
  },
  adButtonText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Lato-Regular',
    lineHeight:14
  },
  loadingContainer: {
    width: '100%',
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius:12
  },
  errorContainer: {
    width: '100%',
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8d7da',
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    color: isDarkMode ? 'white' : 'black',
    fontSize: 14,
    fontFamily: 'Lato-Regular',
  },
});

export default MyNativeAdComponent;
