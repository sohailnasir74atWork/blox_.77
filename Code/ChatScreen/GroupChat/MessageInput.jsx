import React, { useState, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';
import { getStyles } from './../Style';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import getAdUnitId from '../../Ads/ads';
import { AdEventType, InterstitialAd } from 'react-native-google-mobile-ads';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';

const interstitialAdUnitId = getAdUnitId('interstitial');
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId, {
  requestNonPersonalizedAdsOnly: true
});
const MessageInput = ({
  input,
  setInput,
  handleSendMessage,
  selectedTheme,
  replyTo,
  onCancelReply,
}) => {
  const styles = getStyles(selectedTheme.colors.text === 'white');
  const [isSending, setIsSending] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [messageCount, setMessageCount] = useState(0);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { t } = useTranslation();
  const {localState} = useLocalState()

  useEffect(() => {
    interstitial.load();

    const onAdLoaded = () => setIsAdLoaded(true);
    const onAdClosed = () => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      interstitial.load(); // Reload ad for the next use
    };
    const onAdError = (error) => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      console.error('Ad Error:', error);
    };

    const loadedListener = interstitial.addAdEventListener(AdEventType.LOADED, onAdLoaded);
    const closedListener = interstitial.addAdEventListener(AdEventType.CLOSED, onAdClosed);
    const errorListener = interstitial.addAdEventListener(AdEventType.ERROR, onAdError);

    return () => {
      loadedListener();
      closedListener();
      errorListener();
    };
  }, []);

  const showInterstitialAd = (callback) => {
    if (isAdLoaded) {
      setIsShowingAd(true);
      try {
        interstitial.show();
        interstitial.addAdEventListener(AdEventType.CLOSED, callback);
      } catch (error) {
        console.error('Error showing interstitial ad:', error);
        setIsShowingAd(false);
        callback(); // Proceed with fallback in case of error
      }
    } else {
      callback(); // If ad is not loaded, proceed immediately
    }
  };

  const handleSend = async () => {
    triggerHapticFeedback('impactLight');
    const trimmedInput = input.trim();
    if (!trimmedInput || isSending) return; // Prevent empty messages or multiple sends
    setIsSending(true);
  
    try {
      await handleSendMessage(replyTo, trimmedInput);
      setInput('');
      if (onCancelReply) onCancelReply();
  
      // Increment message count
      setMessageCount(prevCount => {
        const newCount = prevCount + 1;
        if (!localState.isPro && newCount % 5 === 0) {
          // Show ad only if user is NOT pro
          showInterstitialAd(() => setIsSending(false));
        } else {
          setIsSending(false);
        }
        return newCount;
      });
    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
    }
  };
  
  return (
    <View style={styles.inputWrapper}>
      {/* Reply context UI */}
      {replyTo && (
        <View style={styles.replyContainer}>
          <Text style={styles.replyText}>
            {t("chat.replying_to")}: {replyTo.text}
          </Text>
          <TouchableOpacity onPress={onCancelReply} style={styles.cancelReplyButton}>
            <Icon name="close-circle" size={24} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, { color: selectedTheme.colors.text }]}
          placeholder={t("chat.type_message")}
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: input.trim() && !isSending ? '#1E88E5' : config.colors.primary },
          ]}
          onPress={handleSend}
          disabled={!input.trim() || isSending}
        >
          <Text style={styles.sendButtonText}>{isSending ? t("chat.sending") : t("chat.send")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default MessageInput;
