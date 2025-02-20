import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  ScrollView,
  Image,
  Animated
} from 'react-native';
import { useGlobalState } from '../GlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import config from '../Helper/Environment';
import Ionicons from 'react-native-vector-icons/Ionicons';

const { width } = Dimensions.get('window');
const images = [
  require('../../assets/BarrierFruit.png'),
  require('../../assets/BladeFruit.png'),
  require('../../assets/BlizzardFruit.png'),
  require('../../assets/BombFruit.png'),
  require('../../assets/BuddhaFruit.png'),
  require('../../assets/ControlFruit.png'),
  require('../../assets/DarkFruit.png'),
  require('../../assets/DiamondFruit.png'),
  require('../../assets/DoughFruit.png'),
  require('../../assets/DragonEastFruit.png'),
  require('../../assets/DragonFruit.png'),
  require('../../assets/FalconFruit.png'),
  require('../../assets/FlameFruit.png'),
  require('../../assets/GasFruit.png'),
  require('../../assets/GhostFruit.png'),
  require('../../assets/GravityFruit.png'),
  require('../../assets/IceFruit.png'),
  require('../../assets/LightFruit.png'),


];
const icon = config.isNoman ?  require('../../assets/icon.webp') : require('../../assets/logo.webp');


const OnboardingScreen = ({ onFinish, selectedTheme }) => {
  const [screenIndex, setScreenIndex] = useState(0);
  const [openSignin, setOpenSignin] = useState(false);
  const { theme, user } = useGlobalState();
  const isDarkMode = theme === 'dark' || selectedTheme === 'dark';
  

  const handleNext = () => {
    if (screenIndex === 0) {
      setScreenIndex(1);
    } else if (screenIndex === 1) {
      user?.id ? setScreenIndex(2) : setOpenSignin(true);
    } else {
      onFinish();
    }
  };

  const handleGuest = () => {
    setScreenIndex(2);
  };

  const handleLoginSuccess = () => {
    setOpenSignin(false);
  };

  const createSlideAnimation = (direction) => {
    const animatedValue = new Animated.Value(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: direction * -width * images.length,
          duration: 80000,
          useNativeDriver: true
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true
        })
      ])
    ).start();
    return animatedValue;
  };

  const translateX1 = createSlideAnimation(1);
  const translateX2 = createSlideAnimation(-1);
  const translateX3 = createSlideAnimation(1);

  const renderSlider = (translateX, imageSubset = []) => (
    <Animated.View style={{ flexDirection: 'row', transform: [{ translateX }] }}>
      {(imageSubset.length > 0 ? [...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset] : []).map((img, index) => (
        <Image key={index} source={img} style={styles.image} />
      ))}
    </Animated.View>
  );
  
  const firstSliderImages = images.slice(0, 6);  // First 6 images
const secondSliderImages = images.slice(6, 12); // Next 6 images
const thirdSliderImages = images.slice(12, 18); // Remaining images (ensure at least 6)

    
  

  const renderScreen = () => {
    switch (screenIndex) {
      case 0:
        return (
          <View style={styles.slide}>
             <Image source={icon} style={styles.iconmain} />
             <View>
             <View style={styles.sliderContainer}>{renderSlider(translateX1, firstSliderImages)}</View>
<View style={styles.sliderContainer}>{renderSlider(translateX2, secondSliderImages)}</View>
<View style={styles.sliderContainer}>{renderSlider(translateX3, thirdSliderImages)}</View></View>
<View>
            {/* <View style={styles.spacer}></View> */}
            <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>Welcome to Fruit Values</Text>
            <Text style={[styles.text, { color: isDarkMode ? '#ccc' : '#666' }]}>Track fruit values & optimize your trades.</Text></View>
          </View>
        );
      case 1:
        return (
          <View style={styles.slide}>
             <Image source={icon} style={styles.iconmain} />
             <View>
             <View style={styles.sliderContainer}>{renderSlider(translateX1, firstSliderImages)}</View>
<View style={styles.sliderContainer}>{renderSlider(translateX2, secondSliderImages)}</View>
<View style={styles.sliderContainer}>{renderSlider(translateX3, thirdSliderImages)}</View></View>
            {/* <View style={styles.spacer}></View> */}
            <View>
            {!user.id &&<Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>Signin or Continue as Guest</Text>}
            {user?.id && (
  <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>
   {`Welcome ${user?.displayName || user?.displayname || 'Anonymous'}`}

  </Text>
)}

            <Text style={[styles.text, { color: isDarkMode ? '#ccc' : '#666' }]}>Get notified, create and bid on trades, chat with traders, and join group discussions.</Text></View>
        </View>
        
        );
      case 2:
        return <SubscriptionScreen visible={true} onClose={onFinish} />;
      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#121212' : '#f2f2f7' }]}>  
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={ isDarkMode ? '#121212' : '#f2f2f7'} />
      {renderScreen()}
      {screenIndex !== 2 && <View style={styles.bottomContainer}>
        <TouchableOpacity style={styles.button} onPress={handleNext}>
          <Text style={styles.buttonText}>{screenIndex === 1 && !user.id ? 'Signin' : 'Continue'}</Text>
        </TouchableOpacity>
        {screenIndex === 1 && !user?.id && (
          <TouchableOpacity style={styles.buttonOutline} onPress={handleGuest}>
            <Text style={styles.buttonTextOutline}>Guest User</Text>
          </TouchableOpacity>
        )}
      </View>}
      <SignInDrawer visible={openSignin} onClose={() => setOpenSignin(false)} onLoginSuccess={handleLoginSuccess} selectedTheme={selectedTheme} />
    </View>
  );
};


const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: { width: width, alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 20,  paddingBottom:120, flex:1 },
  title: { fontSize: 22, fontFamily: 'Lato-Bold', marginBottom: 10, textAlign: 'center', lineHeight:30, paddingTop:20 },
  text: { fontSize: 12, textAlign: 'center', paddingHorizontal: 20, fontFamily: 'Lato-Regular' },
  welcomeText: { fontSize: 18, fontFamily: 'Lato-Bold', marginBottom: 10, textAlign: 'center' },
  button: { backgroundColor: config.colors.hasBlockGreen, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, marginBottom: 10, width: '90%', alignItems: 'center', borderColor: config.colors.hasBlockGreen, borderWidth: 2, },
  buttonText: { color: '#fff', fontSize: 14, textAlign: 'center', fontFamily: 'Lato-Bold' },
  buttonOutline: { borderColor: config.colors.hasBlockGreen, borderWidth: 2, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, width: '90%', alignItems: 'center', marginBottom: 10 },
  buttonTextOutline: { color: config.colors.hasBlockGreen, fontSize: 14, textAlign: 'center', fontFamily: 'Lato-Bold' },
  skipButton: { position: 'absolute', top: 40, right: 20, zIndex: 10 },
  skipButtonText: { fontSize: 16, fontFamily: 'Lato-Bold' },
  image: { width: 50, height: 50, margin: 10, borderRadius: 10 },
  bottomContainer: {
    position: 'absolute',
    bottom: 10,
    width: '100%',
    alignItems: 'center',
  },
  spacer:{
    height:100
  },
  benefitsContainer: {
  width: '100%',
  marginTop: 20,
  alignItems: 'center',
},

benefitCard: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 5,
  paddingHorizontal: 16,
  borderRadius: 12,
  width: '90%',
  marginBottom: 10,
},

icon: {
  marginRight: 12,
},

benefitText: {
  fontSize: 16,
  color: '#fff',
  fontFamily:'Lato-Bold'
},
sliderContainer:{
  paddingVertical:5
},
iconmain:{
  // position: 'absolute',
  // top: 100,
  borderRadius:10,
  width: 150,
  alignItems: 'center',
  height:150,
  paddingTop:50
}

});

export default OnboardingScreen;
