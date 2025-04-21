import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Image,
  Modal,
} from 'react-native';
import { useGlobalState } from '../GlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import config from '../Helper/Environment';
import { useLanguage } from '../Translation/LanguageProvider';
import { useTranslation } from 'react-i18next';
import {  GestureHandlerRootView } from 'react-native-gesture-handler';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { mixpanel } from './MixPenel';

const { width } = Dimensions.get('window');

const icon = config.isNoman ? require('../../assets/icon.webp') : require('../../assets/logo.webp');


const OnboardingScreen = ({ onFinish, selectedTheme }) => {
  const [screenIndex, setScreenIndex] = useState(0);
  const [openSignin, setOpenSignin] = useState(false);
  const { theme, user, analytics } = useGlobalState();
  const isDarkMode = theme === 'dark' || selectedTheme === 'dark';
  const { language, changeLanguage } = useLanguage();
  const { t } = useTranslation();
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  // const platform = Platform.OS.toLowerCase();


  // const languageOptions = [
  //   { code: "en", label: t("settings.languages.en"), flag: "🇺🇸" },
  //   { code: "fil", label: t("settings.languages.fil"), flag: "🇵🇭" },
  //   { code: "vi", label: t("settings.languages.vi"), flag: "🇻🇳" },
  //   { code: "pt", label: t("settings.languages.pt"), flag: "🇵🇹" },
  //   { code: "id", label: t("settings.languages.id"), flag: "🇮🇩" },
  //   { code: "es", label: t("settings.languages.es"), flag: "🇪🇸" },
  //   { code: "fr", label: t("settings.languages.fr"), flag: "🇫🇷" },
  //   { code: "de", label: t("settings.languages.de"), flag: "🇩🇪" },
  //   { code: "ru", label: t("settings.languages.ru"), flag: "🇷🇺" },
  //   { code: "ar", label: t("settings.languages.ar"), flag: "🇸🇦" }

  // ];

  const handleNext = () => {
    if (screenIndex === 0) {
      mixpanel.track("New Install");
      setScreenIndex(1);
    } else if (screenIndex === 1) {
      user?.id ? setScreenIndex(2) : setOpenSignin(true);
    } else {
      onFinish();
    }
  };

  const handleGuest = () => {
    mixpanel.track("Go as Guest");
    setScreenIndex(2);
  };

  const handleLoginSuccess = () => {
    setOpenSignin(false);
  };

  // const createSlideAnimation = (direction) => {
  //   const animatedValue = new Animated.Value(0);
  //   Animated.loop(
  //     Animated.sequence([
  //       Animated.timing(animatedValue, {
  //         toValue: direction * -width * images.length,
  //         duration: 80000,
  //         useNativeDriver: true
  //       }),
  //       Animated.timing(animatedValue, {
  //         toValue: 0,
  //         duration: 0,
  //         useNativeDriver: true
  //       })
  //     ])
  //   ).start();
  //   return animatedValue;
  // };

  // const translateX1 = createSlideAnimation(1);
  // const translateX2 = createSlideAnimation(-1);
  // const translateX3 = createSlideAnimation(1);

  // const renderSlider = (translateX, imageSubset = []) => (
  //   <Animated.View style={{ flexDirection: 'row', transform: [{ translateX }] }}>
  //     {(imageSubset.length > 0 ? [...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset, ...imageSubset] : []).map((img, index) => (
  //       <Image key={index} source={img} style={styles.image} />
  //     ))}
  //   </Animated.View>
  // );

  // const firstSliderImages = images.slice(0, 6);  // First 6 images
  // const secondSliderImages = images.slice(6, 12); // Next 6 images
  // const thirdSliderImages = images.slice(12, 18); // Remaining images (ensure at least 6)




  const renderScreen = () => {
    switch (screenIndex) {
      case 0:
        return (
          <View style={styles.slide}>
            <Image source={icon} style={styles.iconmain} />
            {/* <View>
              <View style={styles.sliderContainer}>{renderSlider(translateX1, firstSliderImages)}</View>
              <View style={styles.sliderContainer}>{renderSlider(translateX2, secondSliderImages)}</View>
              <View style={styles.sliderContainer}>{renderSlider(translateX3, thirdSliderImages)}</View></View> */}
            <View>
              {/* <View style={styles.spacer}></View> */}
              <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>{t("first.welcome_title")}</Text>
              <Text style={[styles.text, { color: isDarkMode ? '#ccc' : '#666' }]}>{t("first.welcome_text")}</Text>
            </View>
          </View>
        );
      case 1:
        return (
          <View style={styles.slide}>
            <Image source={icon} style={styles.iconmain} />
            {/* <View>
              <View style={styles.sliderContainer}>{renderSlider(translateX1, firstSliderImages)}</View>
              <View style={styles.sliderContainer}>{renderSlider(translateX2, secondSliderImages)}</View>
              <View style={styles.sliderContainer}>{renderSlider(translateX3, thirdSliderImages)}</View>
              </View> */}
            {/* <View style={styles.spacer}></View> */}
            <View>
              {!user.id && <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>{t("first.signin_or_guest")}</Text>}
              {user?.id && (
                <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>
                  {`Welcome ${user?.displayName || 'Anonymous'}`}

                </Text>
              )}

              <Text style={[styles.text, { color: isDarkMode ? '#ccc' : '#666' }]}>{t("first.get_notified_text")}</Text></View>
          </View>

        );
      case 2:
        return <SubscriptionScreen visible={true} onClose={onFinish} track='On Boarding'/>;
      default:
        return null;
    }
  };

  return (
    <GestureHandlerRootView>
      <View style={[styles.container, { backgroundColor: isDarkMode ? '#121212' : '#f2f2f7' }]}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={isDarkMode ? '#121212' : '#f2f2f7'} />
        {renderScreen()}

        {screenIndex !== 2 && <View style={styles.bottomContainer}>
         
          <TouchableOpacity style={styles.button} onPress={handleNext}>
            <Text style={styles.buttonText}>{screenIndex === 1 && !user.id ? t("first.signin") : t("first.continue")}</Text>
          </TouchableOpacity>
          {screenIndex === 1 && !user?.id && (
            <TouchableOpacity style={styles.buttonOutline} onPress={handleGuest}>
              <Text style={styles.buttonTextOutline}>{t("first.guest_user")}</Text>
            </TouchableOpacity>
          )}
        </View>}

        <SignInDrawer visible={openSignin} onClose={handleLoginSuccess}  selectedTheme={selectedTheme} screen='On Boarding'/>
        <Modal visible={languageModalVisible} animationType="slide" transparent>
          <View style={[styles.modalContainer, { backgroundColor: isDarkMode ? '#121212' : '#f2f2f7' }]}>
            {/* <Text style={[styles.modalTitle, { color: isDarkMode ? 'white' : '#666' }]}>{t("settings.select_language")}</Text>
            <FlatList
              data={languageOptions}
              keyExtractor={(item) => item.code}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.languageOption}
                  onPress={() => {
                    changeLanguage(item.code);
                    setAppLanguage(item.code);
                    setLanguageModalVisible(false);

                  }}
                >
                  <Text style={[styles.languageText, { color: isDarkMode ? 'white' : '#666' }]}>{item.flag} {item.label}</Text>
                </TouchableOpacity>
              )}
            /> */}
          </View>
          <Ionicons name="close" size={34} color={isDarkMode ? '#ccc' : '#666'} style={styles.skipButton} onPress={() => { setLanguageModalVisible(false) }} />
        </Modal>

      </View>
    </GestureHandlerRootView>
  );
};


const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: { width: width, alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 20,  flex: 1 },
  title: { fontSize: 24, fontFamily: 'Lato-Bold', marginBottom: 10, textAlign: 'center', lineHeight: 30},
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
  spacer: {
    height: 100
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
    fontFamily: 'Lato-Bold'
  },
  sliderContainer: {
    paddingVertical: 5
  },
  iconmain: {
    // position: 'absolute',
    // top: 100,
    borderRadius: 10,
    width: 150,
    alignItems: 'center',
    height: 150,
    paddingTop: 50
  },
  languageButton: {
    alignSelf: 'center',
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007BFF',
  },
  languageButtonText: {
    fontSize: 16,
    color: '#007BFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: width,
    height: '100%',
    backgroundColor: 'white',
    // borderRadius: 12,
    padding: 20,
    paddingTop: 80,

    // alignItems: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontFamily: 'Lato-Bold',
    marginVertical: 15,
    alignSelf: 'center'
  },
  languageOption: {
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    width: '100%',
    alignItems: 'left',
  },
  languageText: {
    fontSize: 16,
    fontFamily: 'Lato-Bold'
  }

});

export default OnboardingScreen;
