  import React, { useState, useEffect, useRef, useMemo } from 'react';
  import {
    View,
    TouchableOpacity,
    Modal,
    Animated,
    Text,
    Linking,
    StyleSheet,
    Platform,
    ActivityIndicator,
    ScrollView,
  } from 'react-native';
  import Ionicons from 'react-native-vector-icons/Ionicons';
  import { useGlobalState } from '../GlobelStats';
  import { useLocalState } from '../LocalGlobelStats';
  import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';

  const SubscriptionScreen = ({ visible, onClose, track }) => {
    const [activePlan, setActivePlan] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingRestore, setLoadingReStore] = useState(false);
    const [showCloseButton, setShowCloseButton] = useState(false);
    const [progress, setProgress] = useState(0);
    const radius = 20;
    const animatedValue = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(500)).current; // Starts off-screen
    const { theme } = useGlobalState();
    const { packages, purchaseProduct, restorePurchases } = useLocalState();
    const { t } = useTranslation();

    const isDarkMode = theme === 'dark';

    useEffect(() => {
      Animated.timing(slideAnim, {
          toValue: visible ? 0 : 500, 
          
          duration: 300,
          useNativeDriver: true,
      }).start();
  }, [visible]);


    useEffect(() => {
      if (visible) {
        setShowCloseButton(false);
        setProgress(0);
        animatedValue.setValue(0);

        Animated.timing(animatedValue, {
          toValue: 100,
          duration: 2500, // 10 seconds
          useNativeDriver: false,
        }).start(() => {
          setShowCloseButton(true);
        });

        animatedValue.addListener(({ value }) => {
          setProgress(value);
        });

        return () => animatedValue.removeAllListeners();
      }
    }, [visible]);


    useEffect(() => {
      if (visible && !activePlan && packages?.length) {
        setActivePlan(packages[0]);
      }
    }, [visible, packages]);

    const handleSelectPlan = (pkg) => {setActivePlan(pkg); console.log(pkg)
    }

    const handlePurchase = () => {
      if (activePlan) {
        setLoading(true); // Start loading before calling the function
        purchaseProduct(activePlan, setLoading, track);
      }
    };
    const handleRestorePur = () => {
        restorePurchases(setLoadingReStore);
    };
    

    const openLink = (url) => {
      Linking.openURL(url).catch((err) => console.error('Error opening URL:', err));
    };

    const tremofsvc = Platform.OS === 'android' ? 'https://play.google.com/about/play-terms/index.html' : 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

    const benefits = [
      { icon: 'shield-checkmark', label: t('offer.adsFree'), color: '#4CAF50' }, // Green
      { icon: 'swap-horizontal', label: t('offer.unlimitedTrade'), color: '#FF9800' }, // Orange
      // { icon: 'chatbubbles', label: t('offer.unlimitedChat'), color: '#2196F3' }, // Blue
      { icon: 'notifications', label: t('offer.unlimitedAlerts'), color: '#9C27B0' }, // Purple
      { icon: 'trending-up', label: t('offer.priorityListing'), color: '#E91E63' }, // Pink
      { icon: 'checkmark-done-circle', label: t('offer.proTag'), color: config.colors.hasBlockGreen },
      // { icon: 'star', label: t('offer.featureListing'), color: '#FFD700' },
      // { icon: 'language', label: 'You can select multiple languages', color: config.colors.wantBlockRed },
      { icon: 'trophy', label: 'Win prizes on every weekend', color: 'red' }    
    ];
    const calculateDiscount = (monthlyPrice, quarterlyPrice, annualPrice) => {
      if (!monthlyPrice || !quarterlyPrice || !annualPrice) return {};
    
      const expectedQuarterlyPrice = monthlyPrice * 3;
      const expectedAnnualPrice = monthlyPrice * 12;
    
      const quarterlyDiscount = ((expectedQuarterlyPrice - quarterlyPrice) / expectedQuarterlyPrice) * 100;
      const annualDiscount = ((expectedAnnualPrice - annualPrice) / expectedAnnualPrice) * 100;
    
      return {
        quarterlyDiscount: quarterlyDiscount > 0 ? `${quarterlyDiscount.toFixed(0)}% OFF` : null,
        annualDiscount: annualDiscount > 0 ? `${annualDiscount.toFixed(0)}% OFF` : null,
      };
    };
    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

    return (
      <Modal transparent visible={visible} animationType="fade">
          <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]}>
          <ScrollView 
                contentContainerStyle={{flex:1}} 
                showsVerticalScrollIndicator={false} 
                keyboardShouldPersistTaps="handled"
            >
          <TouchableOpacity onPress={onClose} disabled={!showCloseButton} style={styles.closeButton}>
            {showCloseButton &&
              <Ionicons name="close" size={24} color="grey" />
           }
          </TouchableOpacity>
            
            <Text style={styles.title}>GO PRO 
              {/* <Ionicons name="checkmark-done-circle" size={26} color={config.colors.hasBlockGreen}  style={styles.icon}/> */}
            </Text>
            <Text style={styles.subtitle}>{t('offer.subtitle')}</Text>

            <View style={styles.benefitsContainer}>
              {benefits.map((benefit, index) => (
                <View key={index} style={styles.benefitItem}>
                  <Ionicons name={benefit.icon} size={20} color={benefit.color} />
                  <Text style={styles.benefit}>{benefit.label}</Text>
                </View>
              ))}
            </View>
            <View style={{flex:1}}></View>
            <View style={styles.plansContainer}>
              {packages?.slice().reverse().map((pkg, index) => {
                const product = pkg.product || {};
                const isSelected = activePlan?.identifier === pkg.identifier;
                const monthlyPlan = packages.find((p) => p.packageType === 'MONTHLY')?.product?.price;
                const quarterlyPlan = packages.find((p) => p.packageType === 'THREE_MONTH')?.product?.price;
                const annualPlan = packages.find((p) => p.packageType === 'ANNUAL')?.product?.price;
          
                // Get the discount values
                const { quarterlyDiscount, annualDiscount } = calculateDiscount(monthlyPlan, quarterlyPlan, annualPlan);
                return (
                  <TouchableOpacity key={pkg.identifier} onPress={() => handleSelectPlan(pkg)} style={[styles.planBox, isSelected && styles.selectedPlan]}>
                    {pkg.packageType === 'ANNUAL' && annualDiscount && isSelected && (
              <View style={styles.discountBox}>
                <Text style={styles.discountTag}>{annualDiscount}</Text>
              </View>
            )}
            {pkg.packageType === 'THREE_MONTH' && quarterlyDiscount && isSelected && (
              <View style={[styles.discountBox, {backgroundColor:config.colors.secondary}]}>
                <Text style={styles.discountTag}>{quarterlyDiscount}</Text>
              </View>
            )}
                    <Text style={styles.planTitle}>
            {pkg.packageType === 'ANNUAL' ? t('offer.annual') :
            pkg.packageType === 'THREE_MONTH' ? t('offer.quarterly') : 
            t('offer.monthly')}
              {isSelected && <Ionicons name="checkmark-circle" size={20} color={config.colors.hasBlockGreen}  style={styles.icon}/>}
            {!isSelected && <Ionicons name="ellipse-outline" size={20} color={config.colors.hasBlockGreen} style={styles.icon}/>}
          </Text>
                    <Text style={styles.planPrice}>{product.priceString}/{pkg.packageType === 'ANNUAL' ? 'Year' :
            pkg.packageType === 'THREE_MONTH' ? '3 Months' : 
            'Month'}</Text>
                    <Text style={styles.cancelAnytime}>{t('offer.cancelAnytime')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity 
    onPress={handlePurchase} 
    style={[styles.subscribeButton, loading && { opacity: 0.7 }]} // Reduce opacity while loading
    disabled={loading} // Disable button when loading
  >
    {loading ? (
      <ActivityIndicator size="small" color="white" />
    ) : (
      <Text style={styles.subscribeButtonText}>{t('offer.continue')}</Text>
    )}
  </TouchableOpacity>

            <TouchableOpacity onPress={handleRestorePur} style={styles.restorePurchases}>
            {loadingRestore ? (
      <ActivityIndicator size="small" color="white" />
    ) : (
      <Text style={[styles.subscribeButtonText, {color:config.colors.hasBlockGreen}]}>{t('offer.restore')}</Text>
    )}
            </TouchableOpacity>

            <View style={styles.containerfooter}>
        <Text style={styles.recurringText}>{t('offer.recurring')}</Text>
        
        <View style={styles.linksContainer}>
          <TouchableOpacity onPress={()=>openLink(tremofsvc)}>
            <Text style={styles.linkText}>{t('offer.termsOfService')}</Text>
          </TouchableOpacity>

          <Text style={styles.separator}> • </Text>

          <TouchableOpacity onPress={()=>openLink('https://bloxfruitscalc.com/privacy-policy/')}>
            <Text style={styles.linkText}>{t('offer.privacyPolicy')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </ScrollView>

          </Animated.View>
      </Modal>
    );
  };
  const getStyles = (isDarkMode) =>
  StyleSheet.create({
      container: {
        width: '100%',
        padding: 20,
        backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
        alignItems: 'center',
        flex: 1,
        paddingTop:40,
      },
      // closeButton: {
      //   alignSelf: 'flex-end',
      //   padding: 10,
      //   // marginBottom:20
      // },
      title: {
        fontSize: 22,
        textAlign: 'center',
        fontFamily: 'Lato-Bold', // Corrected
        color: isDarkMode ? '#fff' : '#000',
      },
      subtitle: {
        fontSize: 14,
        textAlign: 'center',
        color: 'gray',
        marginVertical: 10,
        fontFamily: 'Lato-Regular', // Corrected
        color: isDarkMode ? '#fff' : '#000',
      },
      benefitsContainer: {
        alignSelf: 'stretch',
        marginVertical: 20,

      },
      benefitItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
      },
      benefit: {
        marginLeft: 10,
        fontSize: 12,
        color: isDarkMode ? 'lightgrey' : '#333',
        fontFamily: 'Lato-Bold', // Corrected
        // paddingVertical:5,
        lineHeight:16
      },
      plansContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
        // width:'100%'
      },
      planBox: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'gray',
        alignItems: 'center',
        marginHorizontal: 5,
        justifyContent: 'flex-end',
        width: '30%',
        minHeight: 100,
        paddingBottom:10
      },
      selectedPlan: {
        borderColor: config.colors.hasBlockGreen,
        borderWidth: 2,
      },
      planTitle: {
        fontSize: 10,
        fontFamily: 'Lato-Bold', // Corrected
        color: isDarkMode ? 'white' : '#333',
      },
      planPrice: {
        fontSize: 10,
        color: config.colors.hasBlockGreen,
        marginVertical: 5,
        fontFamily: 'Lato-Regular', // Corrected
      },
      discountBox: {
        backgroundColor: config.colors.hasBlockGreen,
        paddingVertical: 6,
      //   paddingHorizontal: 8,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0, // Ensures full width
        borderTopRightRadius: 8,
        borderTopLeftRadius: 8,
        alignItems: 'center', // Centers content horizontally
        justifyContent: 'center', // Centers text vertically
      },
      discountTag: {
        color: 'white',
        fontSize: 12,
        fontFamily: 'Lato-Bold', // Corrected
        textAlign: 'center',
      },
      subscribeButton: {
        backgroundColor: config.colors.hasBlockGreen,
        paddingVertical: 12,
        paddingHorizontal: 30,
        borderRadius:8,
        alignItems: 'center',
        width: '100%',
        borderColor:config.colors.hasBlockGreen,
        borderWidth:1,
      },
      subscribeButtonText: {
        color: 'white',
        fontSize: 16,
        fontFamily: 'Lato-Bold', // Corrected
      },
      restorePurchases: {
        // backgroundColor: 'lightgrey',
        paddingVertical: 12,
        paddingHorizontal: 30,
        borderRadius:8,
        alignItems: 'center',
        width: '100%',
        marginVertical:10,
        borderColor:config.colors.hasBlockGreen,
        borderWidth:1,
      },
      restoreText: {
        fontSize: 12,
        fontFamily: 'Lato-Regular', // Corrected
        color:config.colors.secondary,
      
      },
      cancelAnytime: {
        fontSize: 9,
        fontFamily: 'Lato-Regular', // Corrected
        color: isDarkMode ? 'lightgrey' : '#333',
        alignSelf:'center'
      },
      icon: {
        margin: 10
      },
      containerfooter: {
        alignItems: 'center',
        marginTop: 10,
      },
      recurringText: {
        fontSize: 14,
        color: '#555', // Slightly muted color
        // marginBottom: 5,
        fontFamily: 'Lato-Regular', // Corrected
        lineHeight:14
      },
      linksContainer: {
        flexDirection: 'row',
        alignItems: 'center',
      },
      linkText: {
        fontSize: 12,
        color: config.colors.secondary,
        textDecorationLine:'underline',
        fontFamily: 'Lato-Regular', // Corrected
        lineHeight:14

      },
      separator: {
        fontSize: 20,
        color: '#555',
        marginHorizontal: 1,
      },
      closeButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        // backgroundColor: "#333",
        justifyContent: "center",
        alignItems: "center",
        alignSelf:'flex-end'
      },
      circularProgress: {
        width: 30,
        height: 30,
        borderRadius: 15,
        justifyContent: "center",
        alignItems: "center",
        alignSelf:'flex-end'
      },
      
    });
    

  export default SubscriptionScreen;
