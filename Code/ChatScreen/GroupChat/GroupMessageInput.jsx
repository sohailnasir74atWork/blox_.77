import React, { useState, useCallback, useMemo } from 'react';
import { View, TextInput, TouchableOpacity, Text, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../Style';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { validateContent } from '../../Helper/ContentModeration';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const base64ToBytes = (base64) => {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('Invalid base64 input');
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];

  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));

    if (enc1 === -1 || enc2 === -1 || enc3 === -1 || enc4 === -1) {
      throw new Error('Invalid base64 character');
    }

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
  const [messageCount, setMessageCount] = useState(0);
  const [imageUri, setImageUri] = useState(null);

  const { localState } = useLocalState();
  const { theme, user } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  const styles = useMemo(() => getStyles(isDark), [isDark]);

  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      const base64 = await RNFS.readFile(imagePath, 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const filePath = `chat/${fileName}`;

      const response = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${filePath}`, {
        method: 'PUT',
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          'Content-Type': 'image/jpeg',
        },
        body: bytes,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      return `${BUNNY_CDN_BASE}/${filePath}`;
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
          setImageUri(asset.uri);
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
      const validation = validateContent(textToSend);
      if (!validation.isValid) {
        Alert.alert('Error', validation.reason || 'Inappropriate content detected.');
        return;
      }
    }

    setIsSending(true);
    setInput('');
    setImageUri(null);
    if (setSelectedFruits && typeof setSelectedFruits === 'function') {
      setSelectedFruits([]);
    }

    setMessageCount((prevCount) => {
      const newCount = prevCount + 1;
      if (!localState?.isPro && newCount % 12 === 0) {
        InterstitialAdManager.showAd(() => setIsSending(false));
      } else {
        setIsSending(false);
      }
      return newCount;
    });

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
      Alert.alert('Error', 'Failed to send message.');
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
    localState?.isPro,
    uploadToBunny,
    replyTo,
    onCancelReply,
  ]);

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
    if (!replyTo) return '[Deleted message]';
    if (replyTo.text && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }
    if (replyTo.imageUrl) {
      return '[Image]';
    }
    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0 ? `[${count} pet(s) message]` : '[Pets message]';
    }
    return '[Deleted message]';
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
          <Text style={{ color: isDark ? '#ccc' : '#555', fontSize: 12 }}>1 image attached</Text>
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
            {selectedFruits.length} pet(s) selected
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
    </View>
  );
};

export default GroupMessageInput;

