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
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';

const SubscriptionScreen = ({ visible, onClose }) => {
  const [activePlan, setActivePlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(500)).current; // Starts off-screen
  const { theme } = useGlobalState();
  const { packages, purchaseProduct, restorePurchases } = useLocalState();
  const isDarkMode = theme === 'dark';

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : 500,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  useEffect(() => {
    if (visible && !activePlan && packages?.length) {
      setActivePlan(packages[0]);
    }
  }, [visible, packages]);

  const handleSelectPlan = (pkg) => setActivePlan(pkg);

  const handlePurchase = () => {
    if (activePlan) {
      setLoading(true); // Start loading before calling the function
      purchaseProduct(activePlan, setLoading);
    }
  };
  

  const openLink = (url) => {
    Linking.openURL(url).catch((err) => console.error('Error opening URL:', err));
  };

  const tremofsvc = Platform.OS === 'android' ? 'https://play.google.com/about/play-terms/index.html' : 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

  const benefits = [
    { icon: 'shield-checkmark', label: 'Ads-Free Experience', color: '#4CAF50' }, // Green
    { icon: 'swap-horizontal', label: 'Unlimited Trade Creation', color: '#FF9800' }, // Orange
    { icon: 'chatbubbles', label: 'Unlimited P2P Chat (Direct Messages)', color: '#2196F3' }, // Blue
    { icon: 'notifications', label: 'Unlimited Stock Alerts & Notifications', color: '#9C27B0' }, // Purple
    { icon: 'trending-up', label: 'Priority Listing', color: '#E91E63' }, // Pink
    { icon: 'checkmark-done-circle', label: 'Get a Pro Tag with your User Name', color: config.colors.hasBlockGreen } // Pink

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
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={"lightgrey"} />
          </TouchableOpacity>
          
          <Text style={styles.title}>GET AHEAD IN THE GAME <Ionicons name="checkmark-done-circle" size={26} color={config.colors.hasBlockGreen}  style={styles.icon}/></Text>
          <Text style={styles.subtitle}>Access exclusive features and trade smarter!</Text>

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
                  {pkg.packageType === 'ANNUAL' && annualDiscount && (
            <View style={styles.discountBox}>
              <Text style={styles.discountTag}>{annualDiscount}</Text>
            </View>
          )}
          {pkg.packageType === 'THREE_MONTH' && quarterlyDiscount && (
            <View style={[styles.discountBox, {backgroundColor:config.colors.secondary}]}>
              <Text style={styles.discountTag}>{quarterlyDiscount}</Text>
            </View>
          )}
                  <Text style={styles.planTitle}>
          {pkg.packageType === 'ANNUAL' ? 'Yearly' :
           pkg.packageType === 'THREE_MONTH' ? 'Quarterly' : 
           'Monthly'}
            {isSelected && <Ionicons name="checkmark-circle" size={20} color={config.colors.hasBlockGreen}  style={styles.icon}/>}
          {!isSelected && <Ionicons name="ellipse-outline" size={20} color={config.colors.hasBlockGreen} style={styles.icon}/>}
        </Text>
                  <Text style={styles.planPrice}>{product.priceString}/{pkg.packageType === 'ANNUAL' ? 'Year' :
           pkg.packageType === 'THREE_MONTH' ? '3 Months' : 
           'Month'}</Text>
                  <Text style={styles.cancelAnytime}>Cancel any time</Text>
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
    <Text style={styles.subscribeButtonText}>Continue</Text>
  )}
</TouchableOpacity>

          <TouchableOpacity onPress={restorePurchases} style={styles.restorePurchases}>
            <Text style={styles.restoreText}>Restore Purchase</Text>
          </TouchableOpacity>

          <View style={styles.containerfooter}>
      <Text style={styles.recurringText}>Recurring billing, cancel anytime</Text>
      
      <View style={styles.linksContainer}>
        <TouchableOpacity onPress={()=>openLink(tremofsvc)}>
          <Text style={styles.linkText}>Terms of Services</Text>
        </TouchableOpacity>

        <Text style={styles.separator}> • </Text>

        <TouchableOpacity onPress={()=>openLink('https://bloxfruitscalc.com/privacy-policy/')}>
          <Text style={styles.linkText}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </View>
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
    closeButton: {
      alignSelf: 'flex-end',
      padding: 10,
      // marginBottom:20
    },
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
    },
    planBox: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'gray',
      alignItems: 'center',
      marginHorizontal: 5,
      justifyContent: 'flex-end',
      width: '33%',
      minHeight: 100,
      paddingBottom:10
    },
    selectedPlan: {
      borderColor: config.colors.hasBlockGreen,
      borderWidth: 2,
    },
    planTitle: {
      fontSize: 16,
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
      borderColor:config.colors.secondary,
      borderWidth:1,
    },
    restoreText: {
      fontSize: 12,
      fontFamily: 'Lato-Regular', // Corrected
      color:config.colors.secondary,
     
    },
    cancelAnytime: {
      fontSize: 10,
      fontFamily: 'Lato-Regular', // Corrected
      color: isDarkMode ? 'lightgrey' : '#333',
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
  });
  

export default SubscriptionScreen;
