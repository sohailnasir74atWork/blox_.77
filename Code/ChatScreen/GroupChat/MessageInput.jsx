import React, { useState, useRef } from 'react';
import { View, TextInput, TouchableOpacity, Text, Modal, Image, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { getStyles } from './../Style';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InterstitialAdManager from '../../Ads/IntAd';
import { showMessage } from 'react-native-flash-message';
import { useGlobalState } from '../../GlobelStats';
import { validateContent } from '../../Helper/ContentModeration';

const Emojies = [
  'e1.png',
  'e2.png',
  'e3.png',
  'e4.png',
  'e5.png',
  'e6.png',
  'e7.png',
  'e8.png',
  'e9.png',
  'e10.png',
  'e11.png',
  'e12.png',
  'e13.png',
  'e14.png',
  'e15.png',
  'e16.png'
];

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
  const insets = useSafeAreaInsets();
  const [isSending, setIsSending] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [messageCount, setMessageCount] = useState(0);
  const { t } = useTranslation();
  const { localState } = useLocalState();
  const [loadingImage, setLoadingImage] = useState(false);
  const { theme, isAdmin, user } = useGlobalState();
  // Admins and full (non-baby) moderators bypass moderation so they can post
  // links, warnings, and quoted content the filter would otherwise block.
  const canBypassModeration = !!isAdmin || (!!user?.isModerator && !user?.isBabyMod);
  const isDark = theme === 'dark';
  // const gifAllowed = true


  const [showEmojiPopup, setShowEmojiPopup] = useState(false); // To show the emoji selection popup
  const [showGifPopup, setShowGifPopup] = useState(false); // To show GIF selection popup
  const lastSendTimeRef = useRef(0); // ✅ Track last send time for cooldown
  const COOLDOWN_MS = 10000; // ✅ 10-sec cooldown for non-pro users
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
    if (isSending) return;

    // ✅ 25-sec cooldown for non-pro users (Trade Chat only)
    if (!localState?.isPro && activeChannelId === 'trade') {
      const now = Date.now();
      const elapsed = now - lastSendTimeRef.current;
      if (elapsed < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        showMessage({
          message: `Please wait ${secondsLeft}s before sending another message.`,
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
          message: validation.reason || "Inappropriate content detected.",
          type: "danger",
          duration: 3000,
        });
        return;
      }
    }

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

      if (!localState?.isPro && newCount % 10 === 0) {
        InterstitialAdManager.showAd(adCallback);
      } else {
        setIsSending(false);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
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
        message: "You need to purchase this item from the store in the reward section.",
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
                hasContent && !isSending ? '#1E88E5' : config.colors.primary,
            },
          ]}
          onPress={() => handleSend()}
          disabled={isSending || !hasContent}
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
            {selectedFruits.length}/4 fruit(s) selected
            {maxFruitsReached && (
              <Text style={{ color: '#e74c3c', fontSize: 11, marginLeft: 4 }}>
                (Max reached)
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
      {/* Emoji Popup Modal */}
      {/* Emoji Popup Modal */}
      <Modal visible={showEmojiPopup} transparent animationType="slide">
        <TouchableOpacity style={modalStyles.backdrop} onPress={() => setShowEmojiPopup(false)}>
          <View style={[modalStyles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={(e) => e.stopPropagation()}>
            <View style={modalStyles.emojiListContainer}>
              {Emojies.map((item) => (
                <TouchableOpacity
                  key={item}
                  onPress={() => selectEmoji(`https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${item}`)}
                  style={modalStyles.emojiContainer}
                >
                  <Image
                    source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${item}` }}
                    style={modalStyles.emojiImage}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>





    </View>
  );
};

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  emojiListContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap', // Allows emojis to wrap when they overflow
    justifyContent: 'space-between', // Aligns items to the start
    marginTop: 10,
  },
  emojiContainer: {
    margin: 10,
    width: 50, // emoji width
    height: 50, // emoji height
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
  },
});

export default MessageInput;
