import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  InteractionManager,
} from 'react-native';
import { NativeAd, NativeAdView } from 'react-native-google-mobile-ads';
import config from '../Helper/Environment';
import getAdUnitId from './ads';
import { useGlobalState } from '../GlobelStats';
import RNBootSplash from "react-native-bootsplash";


const adUnitId = getAdUnitId('native');

const SeamlessNativeAd = () => {
  const [nativeAd, setNativeAd] = useState(null);
  const [loading, setLoading] = useState(true);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  useEffect(() => {
    let isMounted = true;
    let timer;
  
    // Start a timer that will hide the splash screen after 3 seconds
    timer = setTimeout(() => {
      if (isMounted) {
        setLoading(false); // Hide loading state
        InteractionManager.runAfterInteractions(() => {
          RNBootSplash.hide({ fade: true });
        });
      }
    }, 3000); // 3 seconds timer
  
    NativeAd.createForAdRequest(adUnitId)
      .then((ad) => {
        if (isMounted) {
          setNativeAd(ad);
          setLoading(false);
          // Hide splash screen immediately if the ad loads before 3 seconds
          clearTimeout(timer);
          InteractionManager.runAfterInteractions(() => {
            RNBootSplash.hide({ fade: true });
          });
        }
      })
      .catch((error) => {
        console.error('❌ Native Ad Load Error:', error);
        setLoading(false);
        clearTimeout(timer); // Ensure the timer is cleared in case of an error
        InteractionManager.runAfterInteractions(() => {
          RNBootSplash.hide({ fade: true });
        });
      });
  
    return () => {
      isMounted = false;
      clearTimeout(timer); // Clean up timer on unmount
    };
  }, []);
  
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={config.colors.hasBlockGreen} />
      </View>
    );
  }

  if (!nativeAd) return null;

  return (
    <NativeAdView nativeAd={nativeAd} style={styles.card}>
      {/* Icon */}
      {nativeAd.icon?.url && (
        <Image source={{ uri: nativeAd.icon.url }} style={styles.icon} resizeMode="contain" />
      )}

      {/* Headline */}
      <Text style={styles.title}>
        {nativeAd.headline || 'Sponsored App'}
      </Text>

      {/* Body */}
      {nativeAd.body && <Text style={styles.description}>{nativeAd.body}</Text>}

      {/* Rating or Store */}
      {(nativeAd.starRating || nativeAd.store || nativeAd.price) && (
        <Text style={styles.meta}>
          {nativeAd.starRating ? `⭐ ${nativeAd.starRating}/5` : ''}
          {nativeAd.starRating && (nativeAd.store || nativeAd.price) ? ' • ' : ''}
          {nativeAd.store || ''} {nativeAd.store && nativeAd.price ? '•' : ''} {nativeAd.price || ''}
        </Text>
      )}

      {/* Call to Action */}
      {nativeAd.callToAction && (
        <TouchableOpacity style={styles.button}>
          <Text style={styles.buttonText}>{nativeAd.callToAction}</Text>
        </TouchableOpacity>
      )}
    </NativeAdView>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    card: {
      padding: 24,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 24,
    //   width: '100%',
      backgroundColor:isDark ? '#1e2d25' : '#e8f5e9',
    //   borderRadius:10,
    //   margin:10
    },
    icon: {
      width: 100,
      height: 100,
    //   marginBottom: 16,
    //   borderRadius: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      color: isDark ? '#ffffff' : '#000000',
      textAlign: 'center',
    },
    description: {
      fontSize: 14,
      color: isDark ? '#cccccc' : '#555555',
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 10,
    },
    meta: {
      fontSize: 13,
      color: isDark ? '#bbbbbb' : '#666666',
      textAlign: 'center',
      marginBottom: 16,
    },
    button: {
      backgroundColor: config.colors.hasBlockGreen,
      paddingVertical: 12,
      paddingHorizontal: 28,
      borderRadius: 12,
      width: '100%',
      marginTop: 10,
    },
    buttonText: {
      color: '#ffffff',
      fontSize: 16,
      textAlign: 'center',
      fontWeight: 'bold',
    },
    loadingContainer: {
      height: 120,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });

export default SeamlessNativeAd;
