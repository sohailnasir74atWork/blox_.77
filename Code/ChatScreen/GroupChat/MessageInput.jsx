import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Text, FlatList, ActivityIndicator } from 'react-native';
import { getStyles } from './../Style';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
import { CHAT_MESSAGES_PER_AD } from '../../Ads/adPolicy';
import { showMessage } from 'react-native-flash-message';
import { useGlobalState } from '../../GlobelStats';
import { validateContent } from '../../Helper/ContentModeration';
import StickerPicker from '../Stickers/StickerPicker';

const MessageInput = ({
  input,
  setInput,
  handleSendMessage,
  selectedTheme,
  replyTo,
  onCancelReply,
  selectedEmoji, // The selected Emoji state
  setSelectedEmoji, // Function to set selected Emoji
  gifAllowed, // new prop to check if GIFs/Emojis are allowed
  setPetModalVisible,
  selectedFruits,
  setSelectedFruits,
  activeChannelId, // ✅ Channel ID for cooldown control
}) => {
  const styles = getStyles(selectedTheme.colors.text === 'white');
  const [isSending, setIsSending] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [messageCount, setMessageCount] = useState(0);
  const { t } = useTranslation();
  const { localState } = useLocalState();
  const [loadingImage, setLoadingImage] = useState(false);
  const { theme, isAdmin, user } = useGlobalState();
  // Admins and full (non-baby) moderators bypass moderation so they can post
  // links, warnings, and quoted content the filter would otherwise block.
  const canBypassModeration = !!isAdmin || !!user?.isSeniorMod || (!!user?.isModerator && !user?.isBabyMod);
  const isDark = theme === 'dark';
  // const gifAllowed = true


  const [showEmojiPopup, setShowEmojiPopup] = useState(false); // To show the emoji selection popup
  const [showGifPopup, setShowGifPopup] = useState(false); // To show GIF selection popup
  const lastSendTimeRef = useRef(0); // ✅ Track last send time for cooldown
  const COOLDOWN_MS = 10000; // ✅ 10-sec cooldown for non-pro users

  // Universal anti-double-send floor (all users, all channels, Pro included).
  const MIN_SEND_GAP_MS = 1500;
  const sendLockRef = useRef(false);
  const lastAnySendAtRef = useRef(0);
  const cooldownTimerRef = useRef(null);
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(() => () => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
  }, []);
  const hasFruits = Array.isArray(selectedFruits) && selectedFruits.length > 0;
  const maxFruitsReached = Array.isArray(selectedFruits) && selectedFruits.length >= 4;
  const hasContent = (input || '').trim().length > 0 || hasFruits || selectedEmoji;




  const handleSend = async (emojiArg) => {
    triggerHapticFeedback('impactLight');

    const trimmedInput = (input || '').trim();
    const emojiFromArg = typeof emojiArg === 'string' ? emojiArg : undefined;
    const emojiToSend = emojiFromArg || selectedEmoji || null;
    const hasEmoji = !!emojiToSend;
    const fruits = hasFruits ? [...selectedFruits] : [];

    if (!trimmedInput && !hasFruits && !hasEmoji) return;
    // `isSending` is state — two taps in the same frame both read it as false.
    // sendLockRef flips synchronously, so it is the guard that actually holds.
    // The 10s cooldown below only covers non-Pro users in Trade Chat; this
    // 1.5s floor applies everywhere, Pro included.
    if (sendLockRef.current) return;
    if (Date.now() - lastAnySendAtRef.current < MIN_SEND_GAP_MS) return;

    // ✅ 25-sec cooldown for non-pro users (Trade Chat only)
    if (!localState?.isPro && activeChannelId === 'trade') {
      const now = Date.now();
      const elapsed = now - lastSendTimeRef.current;
      if (elapsed < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        showMessage({
          message: t('chat.message_input.cooldown', { seconds: secondsLeft }),
          type: 'warning',
          duration: 2000,
        });
        return;
      }
    }

    // ✅ Comprehensive content moderation check
    if (trimmedInput) {
      const validation = validateContent(trimmedInput, { skipLinkCheck: canBypassModeration, skipAll: canBypassModeration });
      if (!validation.isValid) {
        showMessage({
          message: validation.reason || t('chat.message_common.inappropriate'),
          type: "danger",
          duration: 3000,
        });
        return;
      }
    }

    sendLockRef.current = true;
    setIsSending(true);

    const adCallback = () => setIsSending(false);

    try {
      const success = await handleSendMessage(replyTo, trimmedInput, fruits, emojiToSend);

      // ✅ Don't clear input if validation failed — keep user's typed message
      if (success !== true) {
        setIsSending(false);
        return;
      }

      lastSendTimeRef.current = Date.now(); // ✅ Update cooldown timer after successful send

      setInput('');
      setSelectedFruits([]);
      if (selectedEmoji) setSelectedEmoji(null);
      if (onCancelReply) onCancelReply();

      const newCount = messageCount + 1;
      setMessageCount(newCount);

      if (!localState?.isPro && newCount % CHAT_MESSAGES_PER_AD === 0) {
        InterstitialAdManager.showAd(adCallback);
      } else {
        // One message before the ad message: warm the interstitial so the
        // trigger actually has something to show (lazy-load pipeline).
        if (!localState?.isPro && newCount % CHAT_MESSAGES_PER_AD === CHAT_MESSAGES_PER_AD - 1) InterstitialAdManager.prepare();
        setIsSending(false);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
    } finally {
      // Runs for the early `success !== true` return too, so a rejected send
      // never leaves the lock stuck on.
      lastAnySendAtRef.current = Date.now();
      sendLockRef.current = false;
      setCoolingDown(true);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => setCoolingDown(false), MIN_SEND_GAP_MS);
    }
  };


  const handleImageLoad = () => {
    setLoadingImage(false); // Image has finished loading
  };

  const handleImageLoadStart = () => {
    setLoadingImage(true); // Image is loading
  };

  // Emoji selection function
  const selectEmoji = (emojiUrl) => {
    if (gifAllowed) {
      setSelectedEmoji(emojiUrl);
      handleSend(emojiUrl);
      setShowEmojiPopup(false);   // close picker
    } else {
      showMessage({
        message: t('chat.message_input.gif_locked'),
        type: "info",
        duration: 3000,
      });
    }
  };


  // GIF selection function


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
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              marginRight: 3,
              paddingHorizontal: 3,
              opacity: maxFruitsReached ? 0.5 : 1
            }
          ]}
          onPress={() => {
            if (maxFruitsReached) {
              return; // Don't open modal if max fruits reached
            }
            if (setPetModalVisible) {
              setPetModalVisible(true);
            }
          }}
          disabled={isSending || maxFruitsReached}
        >
          <Icon
            name="logo-octocat"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        <TextInput
          style={[styles.input, { color: selectedTheme.colors.text }]}
          placeholder={t("chat.type_message")}
          placeholderTextColor="#888"
          value={input} // The input text, no emojis/GIFs added here
          onChangeText={setInput}
          multiline
        />


        {/* {(selectedEmoji) && (
          <TouchableOpacity style={{
            position: 'absolute',
            left: 3,
            // width: 40,
            // height: 40,
            borderRadius: 15,
          }} onPress={() => setSelectedEmoji(null)}>
            {loadingImage && <ActivityIndicator size="small" color="#6A5ACD" />}


            <Image
              source={{ uri: selectedEmoji }}
              style={{
                width: 40,
                height: 40,
                resizeMode: 'contain',
              }}
              onLoadStart={handleImageLoadStart}
              onLoad={handleImageLoad}
            />
          </TouchableOpacity>
        )} */}







        <TouchableOpacity onPress={() => setShowEmojiPopup(true)} style={styles.gifButton}>
          <Text style={{ fontSize: 25 }}>😊</Text>
        </TouchableOpacity>


        {/* Send Button */}
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor:
                hasContent && !isSending && !coolingDown ? '#1E88E5' : config.colors.primary,
            },
          ]}
          onPress={() => handleSend()}
          disabled={isSending || coolingDown || !hasContent}
        >
          <Text style={styles.sendButtonText}>{isSending ? t("chat.sending") : t("chat.send")}</Text>
        </TouchableOpacity>

      </View>

      {hasFruits && (
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 4,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: isDark ? '#ccc' : '#555', fontSize: 12 }}>
            {t('chat.message_input.fruits_selected', { count: selectedFruits.length })}
            {maxFruitsReached && (
              <Text style={{ color: '#e74c3c', fontSize: 11, marginLeft: 4 }}>
                {t('chat.message_input.max_reached')}
              </Text>
            )}
          </Text>

          <TouchableOpacity
            onPress={() => setSelectedFruits([])}
            style={{ marginLeft: 8 }}
          >
            <Icon
              name="close-circle"
              size={18}
              color={isDark ? '#ccc' : '#555'}
            />
          </TouchableOpacity>
        </View>
      )}
      <StickerPicker
        visible={showEmojiPopup}
        onClose={() => setShowEmojiPopup(false)}
        onSelect={selectEmoji}
        isDark={isDark}
      />





    </View>
  );
};

export default MessageInput;
