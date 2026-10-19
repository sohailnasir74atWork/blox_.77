import React, { useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../Style';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import { safeCompressImage } from '../../Helper/safeCompressImage';
import RNFS from 'react-native-fs';
import { validateContent } from '../../Helper/ContentModeration';
import StickerPicker, { useStickersSupported } from '../Stickers/StickerPicker';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

// 🔹 simple inline base64 → Uint8Array decoder (no atob / extra libs)
const base64ToBytes = (base64) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];

  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    if (enc3 !== 64) {
      output.push(chr1, chr2);
    } else {
      output.push(chr1);
    }
    if (enc4 !== 64 && enc3 !== 64) {
      output.push(chr3);
    }
  }

  return Uint8Array.from(output);
};

// ✅ Quick message templates for Blox Fruits trading
// Translation keys, resolved with t() at render/send time.
const QUICK_MESSAGE_TEMPLATES = [
  'chat.private_message_input.quick_1', // Interested in your trade!
  'chat.private_message_input.quick_2', // Can we negotiate?
  'chat.private_message_input.quick_3', // What's your best offer?
  'chat.private_message_input.quick_4', // I'm ready to trade!
  'chat.private_message_input.quick_5', // Let me check my inventory
  'chat.private_message_input.quick_6', // Deal accepted!
  'chat.private_message_input.quick_7', // Can you add more?
  'chat.private_message_input.quick_8', // Meet me at the trading hub
  'chat.private_message_input.quick_9', // What fruits do you have?
  'chat.private_message_input.quick_10', // Is this still available?
  'chat.private_message_input.quick_11', // I'll add more fruits
  'chat.private_message_input.quick_12', // Fair trade, let's do it!
  'chat.private_message_input.quick_13', // Can you change something?
  'chat.private_message_input.quick_14', // I'm interested, let's discuss
  'chat.private_message_input.quick_15', // Thanks for the trade!
  'chat.private_message_input.quick_16', // Are you online?
  'chat.private_message_input.quick_17', // When can you trade?
  'chat.private_message_input.quick_18', // I have what you need
  'chat.private_message_input.quick_19', // Let's make a deal!
  'chat.private_message_input.quick_20', // Can we do this trade?
];

const PrivateMessageInput = ({ onSend, replyTo, onCancelReply, isBanned, setPetModalVisible,
  selectedFruits,
  setSelectedFruits, }) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [imageUri, setImageUri] = useState(null); // single image only
  const [showTemplates, setShowTemplates] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const stickersOn = useStickersSupported('private_messages');



  const { theme, user, isAdmin } = useGlobalState();
  // Admins and full (non-baby) moderators bypass moderation so they can post
  // links, warnings, and quoted content the filter would otherwise block.
  const canBypassModeration = !!isAdmin || !!user?.isSeniorMod || (!!user?.isModerator && !user?.isBabyMod);
  const isDark = theme === 'dark';
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();


  const styles = getStyles(isDark);




  const handlePickImage = () => {
    if (isBanned) return;

    launchImageLibrary(
      {
        mediaType: 'photo',
        selectionLimit: 1,
      },
      response => {
        if (!response) return;
        if (response.didCancel) return;

        if (response.errorCode) {
          console.warn(
            'ImagePicker Error:',
            response.errorCode,
            response.errorMessage,
          );

          if (response.errorCode !== 'activity') {
            Alert.alert(t('chat.error'), t('chat.private_message_input.gallery_error'));
          }
          return;
        }

        const asset = response.assets && response.assets[0];
        if (asset?.uri) {
          // Compress before holding in state — large/text-heavy images crash on upload
          safeCompressImage(asset.uri, {
            maxWidth: 1024,
            quality: 0.7,
            returnableOutputType: 'uri',
          })
            .then(({ uri }) => setImageUri(uri || asset.uri))
            .catch(() => setImageUri(asset.uri));
        }
      },
    );
  };

  // 🐰 Upload ONE image to Bunny (no atob)
  const uploadToBunny = useCallback(
    async uri => {
      if (!uri) return null;

      const userId = user?.id ?? 'anon';

      try {
        const filename = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
        const remotePath = `uploads/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
        const uploadUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;

        // read file as base64
        const base64 = await RNFS.readFile(uri.replace('file://', ''), 'base64');

        // convert to bytes without atob
        const binary = base64ToBytes(base64);

        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            AccessKey: BUNNY_ACCESS_KEY,
            'Content-Type': 'application/octet-stream',
          },
          body: binary,
        });

        const txt = await res.text().catch(() => '');
        if (!res.ok) {
          console.warn('Bunny upload failed', res.status, txt);
          Alert.alert(t('chat.error'), t('chat.private_message_input.upload_failed'));
          return null;
        }

        return `${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`;
      } catch (e) {
        console.warn('[Bunny ERROR]', e?.message || e);
        Alert.alert(t('chat.error'), t('chat.private_message_input.upload_failed'));
        return null;
      }
    },
    [user?.id, t],
  );



  const handleSend = async () => {
    const trimmedInput = (input || '').trim();
    const hasImage = !!imageUri;
    const hasFruits = Array.isArray(selectedFruits) && selectedFruits.length > 0;

    // nothing to send
    if (!trimmedInput && !hasImage && !hasFruits) return;
    if (isSending) return;

    // ✅ Comprehensive content moderation check
    if (trimmedInput) {
      const validation = validateContent(trimmedInput, { skipAll: canBypassModeration });
      if (!validation.isValid) {
        Alert.alert(t('chat.error'), validation.reason || t('chat.message_common.inappropriate'));
        return;
      }
    }

    setIsSending(true);
    const textToSend = trimmedInput;
    const imageToSend = imageUri;
    const fruitsToSend = Array.isArray(selectedFruits) ? [...selectedFruits] : [];

    // clear UI
    setInput('');
    setImageUri(null);
    setSelectedFruits([]);

    // No ads on this screen. AdMob's "Ads in private communications" policy
    // prohibits ad serving on screens whose primary focus is a direct
    // message, so the per-message interstitial that used to fire here is
    // gone. Do not reintroduce it — it put the app under restricted ad
    // serving. setIsSending is reset in the finally block below.

    try {

      let imageUrl = null;

      if (imageToSend) {
        imageUrl = await uploadToBunny(imageToSend);
      }

      // 🔺 onSend: text, imageUrl, fruits, replyTo
      await onSend(textToSend, imageUrl, fruitsToSend, replyTo);
      if (onCancelReply) onCancelReply(); // Clear reply context if any
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false); // Reset sending state
    }
  };
  // A sticker goes out on its own; whatever is typed stays in the box.
  const handleSendSticker = async (url) => {
    setShowStickers(false);
    if (isSending || isBanned) return;
    setIsSending(true);
    try {
      await onSend('', null, [], replyTo, url);
      if (onCancelReply) onCancelReply();
    } catch (error) {
      console.error('Error sending sticker:', error);
    } finally {
      setIsSending(false);
    }
  };

  const hasFruits =
    Array.isArray(selectedFruits) && selectedFruits.length > 0;

  const hasContent =
    (input || '').trim().length > 0 || !!imageUri || hasFruits;

  return (
    <View style={styles.inputWrapper}>
      {/* Reply Context */}
      {replyTo && (
        <View style={styles.replyContainer}>
          <Text style={styles.replyText} numberOfLines={1}>
            {t('chat.replying_to')} {
              replyTo.text && replyTo.text.trim().length > 0
                ? replyTo.text
                : replyTo.imageUrl
                  ? t('chat.message_common.reply_image')
                  : replyTo.gif
                    ? t('chat.stickers.reply_preview')
                  : (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)
                    ? t('chat.private_message_input.reply_pets', { count: replyTo.fruits.length })
                    : t('chat.private_message_input.reply_message')
            }
          </Text>
          <TouchableOpacity onPress={onCancelReply} style={styles.cancelReplyButton}>
            <Icon name="close-circle" size={24} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      )}

      {/* Input Container */}
      <View style={styles.inputContainer}>
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={() => setPetModalVisible(true)}
          disabled={isSending || isBanned}
        >
          <Icon
            name="logo-octocat"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        {/* Quick Message Templates */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={() => setShowTemplates(true)}
          disabled={isSending || isBanned}
        >
          <Icon
            name="flash"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        {/* Attach image */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={handlePickImage}
          disabled={isSending || isBanned}
        >
          <Icon
            name="attach"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        {/* Stickers (hidden while the database has no sticker column) */}
        {stickersOn && (
          <TouchableOpacity
            style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
            onPress={() => setShowStickers(true)}
            disabled={isSending || isBanned}
            accessibilityLabel={t('chat.stickers.title')}
          >
            <Icon
              name="happy-outline"
              size={20}
              color={isDark ? '#FFF' : '#000'}
            />
          </TouchableOpacity>
        )}

        <TextInput
          style={[styles.input, { color: isDark ? '#FFF' : '#000' }]}
          placeholder={isBanned ? t('chat.private_message_input.blocked_user') : t("chat.type_message")}
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          multiline
          editable={!isBanned} // Disable input if user is banned
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor:
                hasContent && !isSending ? '#1E88E5' : config.colors.primary,
            },
          ]}
          onPress={handleSend}
          disabled={!hasContent || isSending || isBanned}
        >
          <Text style={styles.sendButtonText}>
            {isSending ? t("chat.sending") : t("chat.send")}
          </Text>
        </TouchableOpacity>
      </View>
      {imageUri && (
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 4,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: isDark ? '#ccc' : '#555', fontSize: 12 }}>
            {t('chat.message_common.image_attached')}
          </Text>

          <TouchableOpacity
            onPress={() => setImageUri(null)}
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

      {/* Quick Message Templates Modal */}
      <Modal
        visible={showTemplates}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTemplates(false)}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'flex-end',
          }}
          activeOpacity={1}
          onPress={() => setShowTemplates(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{
              backgroundColor: isDark ? '#2C2C2C' : '#FFF',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '60%',
              paddingTop: 20,
              paddingBottom: Math.max(insets.bottom, 16),
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingBottom: 15,
                borderBottomWidth: 1,
                borderBottomColor: isDark ? '#444' : '#E0E0E0',
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: 'bold',
                  color: isDark ? '#FFF' : '#000',
                }}
              >
                {t('chat.private_message_input.quick_title')}
              </Text>
              <TouchableOpacity onPress={() => setShowTemplates(false)}>
                <Icon name="close" size={24} color={isDark ? '#FFF' : '#000'} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={QUICK_MESSAGE_TEMPLATES}
              keyExtractor={(item, index) => index.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={{
                    padding: 15,
                    borderBottomWidth: 1,
                    borderBottomColor: isDark ? '#444' : '#E0E0E0',
                  }}
                  onPress={async () => {
                    setShowTemplates(false);

                    // Auto-send the template message
                    const trimmedInput = t(item).trim();
                    if (!trimmedInput || isSending) return;

                    // ✅ Comprehensive content moderation check (safety check for templates)
                    const validation = validateContent(trimmedInput, { skipAll: canBypassModeration });
                    if (!validation.isValid) {
                      Alert.alert(t('chat.error'), validation.reason || t('chat.message_common.inappropriate'));
                      return;
                    }

                    setIsSending(true);
                    const textToSend = trimmedInput;
                    const imageToSend = null;
                    const fruitsToSend = [];

                    // Clear UI
                    setInput('');
                    setImageUri(null);
                    setSelectedFruits([]);

                    try {
                      let imageUrl = null;
                      await onSend(textToSend, imageUrl, fruitsToSend);
                      if (onCancelReply) onCancelReply();
                    } catch (error) {
                      console.error('Error sending template message:', error);
                    } finally {
                      setIsSending(false);
                    }
                  }}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      color: isDark ? '#FFF' : '#000',
                    }}
                  >
                    {t(item)}
                  </Text>
                </TouchableOpacity>
              )}
              style={{ maxHeight: 400 }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <StickerPicker
        visible={showStickers && stickersOn}
        onClose={() => setShowStickers(false)}
        onSelect={handleSendSticker}
        isDark={isDark}
      />
    </View>
  );
};

export default PrivateMessageInput;
