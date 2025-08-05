import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as CompressorImage } from 'react-native-compressor';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';

const CLOUD_NAME = 'djtqw0jb5';
const UPLOAD_PRESET = 'my_upload';
const MAX_IMAGES = 4;

const UploadModal = ({ visible, onClose, onUpload, user }) => {
  const [desc, setDesc] = useState('');
  const [imageUris, setImageUris] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState(['Hot Take']);
  // const [budget, setBudget] = useState('');
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const {localState} = useLocalState()

  const toggleTag = useCallback((tag) => {
    setSelectedTags([tag]);
  }, []);
  

const pickAndCompress = useCallback(async () => {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: MAX_IMAGES,
  });

  if (result.assets?.length > 0) {
    const compressed = [];

    for (const asset of result.assets) {
      try {
        const uri = await CompressorImage.compress(asset.uri, {
          maxWidth: 800,
          quality: 0.7,
        });
        compressed.push(uri);
      } catch (error) {
        console.error('Compression failed:', error);
      }
    }

    setImageUris((prev) => {
      if (prev.length + compressed.length > MAX_IMAGES) {
        // Replace all if over limit
        return compressed.slice(0, MAX_IMAGES);
      }
      return [...prev, ...compressed];
    });
  }
}, []);

  

  const uploadToCloudinary = useCallback(async () => {
    const urls = [];

    for (const uri of imageUris) {
      try {
        const data = new FormData();
        data.append('file', {
          uri,
          type: 'image/jpeg',
          name: 'upload.jpg',
        });
        data.append('upload_preset', UPLOAD_PRESET);

        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
          method: 'POST',
          body: data,
        });

        const json = await res.json();
        if (json?.secure_url) {
          urls.push(json.secure_url);
        }
      } catch (e) {
        console.error('Cloudinary upload error:', e);
      }
    }

    return urls;
  }, [imageUris]);

  const handleSubmit = useCallback(() => {
    if (!user?.id) return;
  
    if (!desc || imageUris.length === 0) {
      return Alert.alert('Missing Info', 'Please add a description and at least one image.');
    }
    // if (strikeInfo) {
    //   const { strikeCount, bannedUntil } = strikeInfo;
    //   const now = Date.now();

    //   if (bannedUntil === 'permanent') {
    //     showMessage({
    //       message: '⛔ Permanently Banned',
    //       description: 'You are permanently banned from creating posts.',
    //       type: 'danger',
    //     });
    //     return;
    //   }

    //   if (typeof bannedUntil === 'number' && now < bannedUntil) {
    //     const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
    //     const hours = Math.floor(totalMinutes / 60);
    //     const minutes = totalMinutes % 60;
    //     const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    //     showMessage({
    //       message: `⚠️ Strike ${strikeCount}`,
    //       description: `You are banned for ${timeLeftText} more minute(s).`,
    //       type: 'warning',
    //       duration: 5000,

    //     });
    //     return;
    //   }
    // }
  
    // Extract core logic into a callback
    const callbackfunction = async () => {
      try {
        setLoading(true);
        const uploadedUrls = await uploadToCloudinary();
        await onUpload(desc, uploadedUrls, selectedTags);
        setDesc('');
        setImageUris([]);
        setSelectedTags(['Showcase']);
        // setBudget('');
        onClose();
      } catch (err) {
        Alert.alert('Upload Failed', 'Something went wrong. Try again.');
      } finally {
        setLoading(false);
      }
    };
  
    // Show ad if not Pro, then execute
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!localState.isPro) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                InterstitialAdManager.showAd(callbackfunction);
              } catch (err) {
                console.warn('[AdManager] Failed to show ad:', err);
                callbackfunction();
              }
            }, 400);
          });
        } else {
          callbackfunction();
        }
      }, 500);
    });
  
  }, [user?.id, desc, imageUris, selectedTags, uploadToCloudinary, onUpload, onClose, useLocalState.isPro]);
  

  const themedStyles = getStyles(isDark);

  return (
    <Modal visible={visible} transparent animationType="slide">
            <View style={{ flexDirection: 'row', flex: 1 }}>

      <ConditionalKeyboardWrapper>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={themedStyles.modalBackground}>
        <TouchableOpacity
          activeOpacity={1}
          style={themedStyles.modalContent}
          onPress={(e) => e.stopPropagation()}
        >
          <TextInput
            style={themedStyles.input}
            placeholder="Write a description..."
            placeholderTextColor={isDark ? '#999' : '#666'}
            value={desc}
            onChangeText={setDesc}
            multiline
          />

          <View style={themedStyles.tagSelector}>
          {[
  'Hot Take',         // 🧨 Opinions that might spark debate
  'Showcase',         // 🌟 Showing off garden, fruits, or flexes
  'Discussion',       // 💬 Starting a general chat or opinion post
  'Looking to Trade', // 🔄 Trade inquiries or offers
  'Unpopular Opinion',// 😬 Spicy or different viewpoints
  'Bug or Glitch',    // 🐞 Reporting issues or funny bugs
  'Event Reaction',   // 🗓️ Feedback or thoughts on a new update
  'Flex or Fake?',    // 🤔 Suspicious or exaggerated showcase
  'Scam Alert',       // 🚨 Warning others about scams or fake trades
  'Rare Find',        // 🔍 Found something unique or surprising
].map((tag) => (
  <TouchableOpacity
    key={tag}
    style={[
      themedStyles.tagButton,
      selectedTags.includes(tag) && themedStyles.tagButtonSelected,
    ]}
    onPress={() => toggleTag(tag)}
  >
    <Text
      style={{
        color: selectedTags.includes(tag) ? '#fff' : isDark ? '#eee' : '#333',
        fontSize: 12,
        fontFamily: 'Lato-Bold',
      }}
    >
      {tag}
    </Text>
  </TouchableOpacity>
))}

          </View>

          {/* <TextInput
            style={themedStyles.input}
            placeholder="Optional: Budget (e.g. 500 Bucks)"
            placeholderTextColor={isDark ? '#999' : '#666'}
            value={budget}
            onChangeText={setBudget}
          /> */}

          <TouchableOpacity style={themedStyles.imagePicker} onPress={pickAndCompress}>
            {imageUris.length > 0 ? (
              <View style={themedStyles.imageGrid}>
                {imageUris.map((uri, idx) => (
                  <Image key={idx} source={{ uri }} style={themedStyles.previewImage} />
                ))}
              </View>
            ) : (
              <Text style={{ color: isDark ? '#aaa' : '#333' }}>Upload up to 4 images</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={themedStyles.uploadBtn} onPress={handleSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={themedStyles.btnText}>Submit</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={themedStyles.cancelBtn}>
            <Text style={themedStyles.btnText}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
      </ConditionalKeyboardWrapper>
      </View>

      
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    modalBackground: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: isDark ? '#222' : '#fff',
      padding: 20,
      borderRadius: 10,
      // width: '90%',
      marginHorizontal:10
    },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#555' : '#ccc',
      padding: 10,
      borderRadius: 6,
      marginBottom: 10,
      color: isDark ? '#eee' : '#000',
      fontFamily: 'Lato-Regular',
    },
    tagSelector: {
      flexDirection: 'row',
      marginBottom: 10,
      flexWrap: 'wrap',
      gap: 8,
    },
    tagButton: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: '#ccc',
      backgroundColor: isDark ? '#333' : '#f0f0f0',
      marginRight: 10,
    },
    tagButtonSelected: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    imagePicker: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 100,
      borderWidth: 1,
      borderColor: isDark ? '#555' : '#ccc',
      borderRadius: 6,
      marginBottom: 10,
      padding: 10,
    },
    imageGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    previewImage: {
      width: 50,
      height: 50,
      borderRadius: 3,
      marginRight: 3,
      marginBottom: 3,
    },
    uploadBtn: {
      backgroundColor: config.colors.secondary,
      padding: 12,
      alignItems: 'center',
      borderRadius: 6,
    },
    cancelBtn: {
      marginTop: 10,
      padding: 10,
      backgroundColor: '#FF3B30',
      borderRadius: 6,
      alignItems: 'center',
    },
    btnText: {
      color: '#fff',
      fontWeight: '600',
      fontFamily: 'Lato-Bold',
    },
  });

export default UploadModal;
