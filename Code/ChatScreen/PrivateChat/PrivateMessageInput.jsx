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
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { validateContent } from '../../Helper/ContentModeration';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY   = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE     = 'https://pull-gag.b-cdn.net';

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
const QUICK_MESSAGE_TEMPLATES = [
  "Interested in your trade!",
  "Can we negotiate?",
  "What's your best offer?",
  "I'm ready to trade!",
  "Let me check my inventory",
  "Deal accepted!",
  "Can you add more?",
  "Meet me at the trading hub",
  "What fruits do you have?",
  "Is this still available?",
  "I'll add more fruits",
  "Fair trade, let's do it!",
  "Can you change something?",
  "I'm interested, let's discuss",
  "Thanks for the trade!",
  "Are you online?",
  "When can you trade?",
  "I have what you need",
  "Let's make a deal!",
  "Can we do this trade?",
];

const PrivateMessageInput = ({ onSend, replyTo, onCancelReply, isBanned, setPetModalVisible,
  selectedFruits,
  setSelectedFruits, }) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [imageUri, setImageUri] = useState(null); // single image only
  const [showTemplates, setShowTemplates] = useState(false);

  const [messageCount, setMessageCount] = useState(0);
  const {localState}= useLocalState()
  

  const { theme , user} = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();


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
            Alert.alert('Error', 'Could not open gallery.');
          }
          return;
        }

        const asset = response.assets && response.assets[0];
        if (asset?.uri) {
          setImageUri(asset.uri);
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
        const filename   = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
        const remotePath = `uploads/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
        const uploadUrl  = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;

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
          Alert.alert('Error', 'Image upload failed, sending message without image.');
          return null;
        }

        return `${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`;
      } catch (e) {
        console.warn('[Bunny ERROR]', e?.message || e);
        Alert.alert('Error', 'Image upload failed, sending message without image.');
        return null;
      }
    },
    [user?.id],
  );



  const handleSend = async () => {
   const trimmedInput = (input || '').trim();
    const hasImage  = !!imageUri;
    const hasFruits = Array.isArray(selectedFruits) && selectedFruits.length > 0;

    // nothing to send
    if (!trimmedInput && !hasImage && !hasFruits) return;
    if (isSending) return;

    // ✅ Comprehensive content moderation check
    if (trimmedInput) {
      const validation = validateContent(trimmedInput);
      if (!validation.isValid) {
        Alert.alert('Error', validation.reason || 'Inappropriate content detected.');
        return;
      }
    }

    setIsSending(true);
    const textToSend   = trimmedInput;
    const imageToSend  = imageUri;
    const fruitsToSend = Array.isArray(selectedFruits) ? [...selectedFruits] : [];

    // clear UI
    setInput('');
    setImageUri(null);
    setSelectedFruits([]);


    setMessageCount(prevCount => {
      const newCount = prevCount + 1;
      if (!localState?.isPro && newCount % 12 === 0) {
        // Show ad only if user is NOT pro
        InterstitialAdManager.showAd(() => {});
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

      // 🔺 onSend: text, imageUrl, fruits
      await onSend(textToSend, imageUrl, fruitsToSend);
      if (onCancelReply) onCancelReply(); // Clear reply context if any
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false); // Reset sending state
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
          <Text style={styles.replyText}>Replying to: {replyTo.text}</Text>
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

        <TextInput
          style={[styles.input, { color: isDark ? '#FFF' : '#000' }]}
          placeholder={isBanned ? 'Blocked User' : t("chat.type_message")}
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
            1 image attached
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
            {selectedFruits.length} pet(s) selected
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
                Quick Messages
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
                    const trimmedInput = item.trim();
                    if (!trimmedInput || isSending) return;

                    // ✅ Comprehensive content moderation check (safety check for templates)
                    const validation = validateContent(trimmedInput);
                    if (!validation.isValid) {
                      Alert.alert('Error', validation.reason || 'Inappropriate content detected.');
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

                    setMessageCount(prevCount => {
                      const newCount = prevCount + 1;
                      if (!localState?.isPro && newCount % 12 === 0) {
                        InterstitialAdManager.showAd(() => {});
                      } else {
                        setIsSending(false);
                      }
                      return newCount;
                    });

                    try {
                      let imageUrl = null;
                      // No image for template messages
                      
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
                    {item}
                  </Text>
                </TouchableOpacity>
              )}
              style={{ maxHeight: 400 }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

export default PrivateMessageInput;
