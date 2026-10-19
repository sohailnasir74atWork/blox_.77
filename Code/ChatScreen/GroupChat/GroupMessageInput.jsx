import React, { useState, useCallback, useMemo } from 'react';
import { View, TextInput, TouchableOpacity, Text, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../Style';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import { launchImageLibrary } from 'react-native-image-picker';
import { safeCompressImage } from '../../Helper/safeCompressImage';
import { uploadImage, UPLOAD_KIND } from '../../Helper/imageUpload';
import { validateContent, containsLink, isAllowedLink } from '../../Helper/ContentModeration';
import StickerPicker, { useStickersSupported } from '../Stickers/StickerPicker';

const GroupMessageInput = ({
  onSend,
  isBanned,
  petModalVisible,
  setPetModalVisible,
  selectedFruits,
  setSelectedFruits,
  replyTo, // Message being replied to
  onCancelReply, // Callback to cancel reply
}) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [imageUri, setImageUri] = useState(null);
  const [showStickers, setShowStickers] = useState(false);
  const stickersOn = useStickersSupported('group_messages');

  const { theme, user, isAdmin } = useGlobalState();
  // Admins and full (non-baby) moderators bypass moderation so they can post
  // links, warnings, and quoted content the filter would otherwise block.
  const canBypassModeration = !!isAdmin || !!user?.isSeniorMod || (!!user?.isModerator && !user?.isBabyMod);
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  const styles = useMemo(() => getStyles(isDark), [isDark]);

  // Server-side upload (Helper/imageUpload.js); stored under chat/ as before.
  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      return await uploadImage(imagePath, UPLOAD_KIND.chat);
    } catch (error) {
      console.error('Error uploading to BunnyCDN:', error);
      throw error;
    }
  }, []);

  const handlePickImage = useCallback(() => {
    if (isBanned) return;

    launchImageLibrary(
      {
        mediaType: 'photo',
        selectionLimit: 1,
      },
      (response) => {
        if (!response || response.didCancel) return;

        if (response.errorCode) {
          console.warn('ImagePicker error:', response.errorMessage);
          return;
        }

        const asset = response.assets?.[0];
        if (asset?.uri) {
          // Compress before upload — large/text-heavy images crash on upload
          safeCompressImage(asset.uri, {
            maxWidth: 1024,
            quality: 0.7,
            returnableOutputType: 'uri',
          })
            .then(({ uri }) => setImageUri(uri || asset.uri))
            .catch(() => setImageUri(asset.uri));
        }
      }
    );
  }, [isBanned]);

  const handleSend = useCallback(async () => {
    if (isSending) return;

    const textToSend = input.trim();
    const imageToSend = imageUri;
    const fruitsToSend = Array.isArray(selectedFruits) ? selectedFruits : [];

    if (!textToSend && !imageToSend && fruitsToSend.length === 0) {
      return;
    }

    // ✅ Comprehensive content moderation check
    if (textToSend) {
      // If the message contains a link, only YouTube and TikTok are allowed for
      // everyone; block everything else (admins/mods bypass entirely).
      if (containsLink(textToSend) && !isAllowedLink(textToSend) && !canBypassModeration) {
        Alert.alert(t('chat.error'), t('chat.message_common.only_yt_tiktok'));
        return;
      }
      // Remaining checks (profanity, spam, NSFW) — link check handled above.
      const validation = validateContent(textToSend, { skipLinkCheck: true, skipAll: canBypassModeration });
      if (!validation.isValid) {
        Alert.alert(t('chat.error'), validation.reason || t('chat.message_common.inappropriate'));
        return;
      }
    }

    setIsSending(true);
    setInput('');
    setImageUri(null);
    if (setSelectedFruits && typeof setSelectedFruits === 'function') {
      setSelectedFruits([]);
    }

    // No per-message interstitial here. User-created groups are private
    // chatrooms, which AdMob's "Ads in private communications" policy
    // prohibits serving on. Only the public community chat (MessageInput.jsx)
    // still shows one. setIsSending is reset in the finally block below.

    try {
      let imageUrl = null;

      if (imageToSend) {
        imageUrl = await uploadToBunny(imageToSend);
      }

      await onSend(textToSend, imageUrl, fruitsToSend, replyTo);

      // Clear reply after successful send
      if (onCancelReply) {
        onCancelReply();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert(t('chat.error'), t('chat.message_common.send_failed'));
    } finally {
      setIsSending(false);
    }
  }, [
    input,
    imageUri,
    selectedFruits,
    isSending,
    onSend,
    setSelectedFruits,
    uploadToBunny,
    replyTo,
    onCancelReply,
    t,
  ]);

  // A sticker goes out on its own; whatever is typed stays in the box.
  const handleSendSticker = useCallback(async (url) => {
    setShowStickers(false);
    if (isSending || isBanned) return;
    setIsSending(true);
    try {
      await onSend('', null, [], replyTo, url);
      if (onCancelReply) onCancelReply();
    } catch (error) {
      console.error('Error sending sticker:', error);
      Alert.alert(t('chat.error'), t('chat.message_common.send_failed'));
    } finally {
      setIsSending(false);
    }
  }, [isSending, isBanned, onSend, replyTo, onCancelReply, t]);

  const hasFruits = useMemo(
    () => Array.isArray(selectedFruits) && selectedFruits.length > 0,
    [selectedFruits]
  );

  const hasContent = useMemo(
    () => (input || '').trim().length > 0 || !!imageUri || hasFruits,
    [input, imageUri, hasFruits]
  );

  // Get reply preview text
  const getReplyPreview = (replyTo) => {
    if (!replyTo) return t('chat.message_common.reply_deleted');
    if (replyTo.text && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }
    if (replyTo.imageUrl) {
      return t('chat.message_common.reply_image');
    }
    if (replyTo.gif) {
      return t('chat.stickers.reply_preview');
    }
    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0 ? t('chat.message_common.reply_pets_count', { count }) : t('chat.message_common.reply_pets');
    }
    return t('chat.message_common.reply_deleted');
  };

  return (
    <View style={styles.inputWrapper}>
      {/* Reply context UI */}
      {replyTo && (
        <View style={[styles.replyContainer, {
          backgroundColor: isDark ? '#374151' : '#E5E7EB',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }]}>
          <Text style={[styles.replyText, { color: isDark ? '#9CA3AF' : '#6B7280', flex: 1 }]} numberOfLines={1}>
            {t('chat.replying_to')}: {getReplyPreview(replyTo)}
          </Text>
          <TouchableOpacity
            onPress={onCancelReply}
            style={styles.cancelReplyButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="close" size={18} color={isDark ? '#9CA3AF' : '#6B7280'} />
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.inputContainer}>
        {/* Pets drawer icon */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={() => {
            if (setPetModalVisible && typeof setPetModalVisible === 'function') {
              setPetModalVisible(true);
            }
          }}
          disabled={isSending || isBanned}
        >
          <Icon name="logo-octocat" size={20} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>

        {/* Attach image */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={handlePickImage}
          disabled={isSending || isBanned}
        >
          <Icon name="attach" size={20} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>

        {/* Stickers (hidden while the database has no sticker column) */}
        {stickersOn && (
          <TouchableOpacity
            style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
            onPress={() => setShowStickers(true)}
            disabled={isSending || isBanned}
            accessibilityLabel={t('chat.stickers.title')}
          >
            <Icon name="happy-outline" size={20} color={isDark ? '#FFF' : '#000'} />
          </TouchableOpacity>
        )}

        <TextInput
          style={[styles.input, { color: isDark ? '#FFF' : '#000' }]}
          placeholder={t('chat.type_message')}
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          multiline
          editable={!isBanned}
        />

        {/* Send */}
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor: hasContent && !isSending ? '#1E88E5' : config.colors.primary,
            },
          ]}
          onPress={handleSend}
          disabled={!hasContent || isSending || isBanned}
        >
          <Text style={styles.sendButtonText}>
            {isSending ? t('chat.sending') : t('chat.send')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Attached image indicator */}
      {imageUri && (
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 4,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: isDark ? '#ccc' : '#555', fontSize: 12 }}>{t('chat.message_common.image_attached')}</Text>
          <TouchableOpacity onPress={() => setImageUri(null)} style={{ marginLeft: 8 }}>
            <Icon name="close-circle" size={18} color={isDark ? '#ccc' : '#555'} />
          </TouchableOpacity>
        </View>
      )}

      {/* Selected fruits indicator */}
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
            {t('chat.message_common.pets_selected', { count: selectedFruits.length })}
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (setSelectedFruits && typeof setSelectedFruits === 'function') {
                setSelectedFruits([]);
              }
            }}
            style={{ marginLeft: 8 }}
          >
            <Icon name="close-circle" size={18} color={isDark ? '#ccc' : '#555'} />
          </TouchableOpacity>
        </View>
      )}

      <StickerPicker
        visible={showStickers && stickersOn}
        onClose={() => setShowStickers(false)}
        onSelect={handleSendSticker}
        isDark={isDark}
      />
    </View>
  );
};

export default GroupMessageInput;

