import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Share,
  Platform,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { ref, set, get } from '@react-native-firebase/database';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import { showMessage } from 'react-native-flash-message';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';


const socialTasks = [
  { id: '1', name: 'TikTok', icon: require('../../../assets/social/tik-tok.png'), color: '', points: 30 },
  { id: '2', name: 'Facebook', icon: require('../../../assets/social/facebook-app-symbol.png'), color: '', points: 30 },
  { id: '3', name: 'Instagram', icon: require('../../../assets/social/instagram.png'), color: '', points: 30 },
  { id: '4', name: 'YouTube', icon: require('../../../assets/social/youtube.png'), color: '', points: 30 },
  { id: '5', name: 'Other', icon: require('../../../assets/social/link.png'), color: '', points: 30 },
];

export default function SocialTasks({ user, appdatabase, setOpenSignin }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [link, setLink] = useState('');
  const [customPlatformName, setCustomPlatformName] = useState('');
  const [submissions, setSubmissions] = useState({});

  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const appShareLink = useMemo(
    () => (Platform.OS === 'ios' ? config.IOsShareLink : config.andriodShareLink),
    []
  );

  useEffect(() => {
    const fetchSubmissions = async () => {
      if (!user?.id) return;
      const refPath = ref(appdatabase, `users/${user.id}/submissions`);
      const snapshot = await get(refPath);
      if (snapshot.exists()) {
        setSubmissions(snapshot.val());
      }
    };
    fetchSubmissions();
  }, [user?.id]);

  const isValidPostLink = (input) => {
    // TikTok URL validation (including deprecated shortened links)
    if (selectedPlatform.name === 'TikTok') {
      // Check for standard TikTok URL
      const isTikTokUrl = /^(https?:\/\/(?:www\.)?tiktok\.com\/[a-zA-Z0-9_-]+)/.test(input);
      // Check for shortened TikTok links (e.g., https://vm.tiktok.com/)
      const isTikTokShortenedUrl = /^(https?:\/\/(?:vm\.)?tiktok\.com\/[a-zA-Z0-9_-]+)/.test(input);

      if (!isTikTokUrl && !isTikTokShortenedUrl) {
        return false; // Invalid if neither standard nor shortened TikTok URL
      }
    }

    // Facebook URL validation (handling both standard and mobile links)
    if (selectedPlatform.name === 'Facebook') {
      // Standard Facebook URL (e.g., https://www.facebook.com/user/)
      const isFacebookUrl = /^(https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9_\.]+)/.test(input);
      // Mobile Facebook URL (e.g., https://m.facebook.com/user/)
      const isFacebookMobileUrl = /^(https?:\/\/m\.facebook\.com\/[a-zA-Z0-9_\.]+)/.test(input);

      if (!isFacebookUrl && !isFacebookMobileUrl) {
        return false; // Invalid if not a valid Facebook URL
      }
    }

    // Instagram URL validation (handling both standard and mobile links)
    if (selectedPlatform.name === 'Instagram') {
      // Standard Instagram URL (e.g., https://www.instagram.com/user/)
      const isInstagramUrl = /^(https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_\.]+)/.test(input);
      // Mobile Instagram URL (e.g., https://m.instagram.com/user/)
      const isInstagramMobileUrl = /^(https?:\/\/m\.instagram\.com\/[a-zA-Z0-9_\.]+)/.test(input);

      if (!isInstagramUrl && !isInstagramMobileUrl) {
        return false; // Invalid if not a valid Instagram URL
      }
    }

    // YouTube URL validation (handling deprecated/shortened URLs and video URLs)
    if (selectedPlatform.name === 'YouTube') {
      // Standard YouTube video URL (e.g., https://www.youtube.com/watch?v=videoID)
      const isYouTubeUrl = /^(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+)/.test(input);
      // Deprecated YouTube URL (e.g., https://m.youtube.com/watch?v=videoID)
      const isYouTubeMobileUrl = /^(https?:\/\/(?:m\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+)/.test(input);
      // Shortened YouTube URL (e.g., https://youtu.be/videoID)
      const isYouTubeShortenedUrl = /^(https?:\/\/(?:www\.)?youtu\.be\/[a-zA-Z0-9_-]+)/.test(input);

      if (!isYouTubeUrl && !isYouTubeMobileUrl && !isYouTubeShortenedUrl) {
        return false; // Invalid if not a valid YouTube URL
      }
    }

    // Check for valid URLs for 'Other' platforms (allow any link starting with 'http' or 'https')
    if (selectedPlatform.name === 'Other') {
      return input && /https?:\/\//.test(input); // Basic URL validation
    }

    // For all other valid platforms, check for standard URL format (starts with http or https)
    return input && /https?:\/\//.test(input); // General URL validation
  };



  const openSubmitModal = (platform) => {
    if (!user?.id) return setOpenSignin(true);
    setSelectedPlatform(platform);
    setLink('');
    setCustomPlatformName('');
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    if (!isValidPostLink(link)) {
      showMessage({
        message: "Invalid Link, Please paste the actual link to your social media post.",
        type: "warning",
        icon: "warning",
      });
      return;
    }

    try {
      const platformName =
        selectedPlatform.name === 'Other' ? customPlatformName.trim() : selectedPlatform.name;
      if (!platformName) {
        showMessage({
          message: "Missing Info, Please provide a platform name.",
          type: "warning",
          icon: "warning",
        });
        return;
      }

      const taskId = `${platformName}_${Date.now()}`;
      const submission = {
        userId: user.id,
        platform: platformName,
        link,
        coins: selectedPlatform.points,
        status: 'Pending',
        submittedAt: Date.now(),
      };

      await set(ref(appdatabase, `submissions/${taskId}`), submission);
      await set(ref(appdatabase, `users/${user.id}/submissions/${taskId}`), {
        platform: platformName,
        link,
        coins: selectedPlatform.points,
        status: 'Pending',
        submittedAt: submission.submittedAt,
      });

      setSubmissions((prev) => ({ ...prev, [taskId]: submission }));
      setModalVisible(false);
    } catch (error) {
      console.error('❌ Submission error:', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
  };


  const handleShare = async () => {
    try {
      await Share.share({
        message: `${config.appName} is the best app for Roblox players: ${appShareLink}`,
      });
    } catch (error) {
      console.warn('Error sharing:', error);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#134611' : '#dbe7c9' }]}>
      {/* Iterating over the tasks */}
      {socialTasks.map((item) => {
        const statusEntry = Object.entries(submissions).find(([_, submission]) => {
          const submittedPlatform = (submission.platform || '').toLowerCase();
          const currentPlatform = item.name.toLowerCase();

          if (item.name === 'Other') {
            return !['tiktok', 'facebook', 'instagram', 'youtube'].includes(submittedPlatform);
          }

          return submittedPlatform === currentPlatform;
        });
        const statusText = statusEntry
          ? statusEntry[1].status === 'Approved'
            ? '✅ Granted'
            : statusEntry[1].status === 'Disapproved Resubmit'
              ? 'Disapproved Resubmit'
              : '⏳ Pending'
          : null;

        // console.log(statusText, 'sss')

        return (
          <View key={item.id} style={[styles.taskItem, { backgroundColor: isDarkMode ? '#123024' : '#86A788' }]}>
            <View style={styles.platformInfo}>
              <Image source={item.icon} style={styles.icon} />
              <Text style={styles.platformName}>{item.name}</Text>
            </View>
            <Text style={styles.pointsText}>+{item.points} Coins</Text>
            {
              (statusText === '⏳ Pending' || statusText === '✅ Granted') ? (
                <View style={styles.submitBtn}>
                  <Text style={styles.submitText}>{statusText}</Text>
                </View>
              ) : statusText === 'Disapproved Resubmit' ? (
                <TouchableOpacity style={[styles.submitBtn, {backgroundColor : statusText === 'Disapproved Resubmit' && config.colors.wantBlockRed}]} onPress={() => openSubmitModal(item)}>
                  <Text style={styles.submitText}>Disapproved Resubmit</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.submitBtn} onPress={() => openSubmitModal(item)}>
                  <Text style={styles.submitText}>Submit</Text>
                </TouchableOpacity>
              )
            }

          </View>
        );
      })}

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
        <ConditionalKeyboardWrapper>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Step-by-Step Guide</Text>

            <ScrollView style={styles.scrollView}>
              <Text style={styles.stepText}>
                🟢 <Text style={styles.bold}>Step 1:</Text> Take a Screenshot{"\n"}
                Open the app and take a screenshot of the home, Trade or Stock screen.
              </Text>

              <Text style={styles.stepText}>
                🟢 <Text style={styles.bold}>Step 2:</Text> Write a Description{"\n"}
                Add a short caption or description. You can use this template or write your own:
                {"\n"}
                “Blox Fruit Values Calc is the best app for Roblox players: https://play.google.com/store/apps/details?id=com.bloxfruitevalues”
              </Text>

              <Text style={styles.stepText}>
                🟢 <Text style={styles.bold}>Step 3:</Text> Share on Social Media{"\n"}
                Post the screenshot + description on one of these platforms:
                {"\n"}
                - TikTok{"\n"}
                - Instagram{"\n"}
                - Facebook{"\n"}
                - YouTube Shorts
              </Text>

              <Text style={styles.stepText}>
                🟢 <Text style={styles.bold}>Step 4:</Text> Submit Proof{"\n"}
                Submit your post link in the submission field.
              </Text>

              <Text style={styles.rulesText}>
                ⚠️ <Text style={styles.bold}>Important Rules:</Text>{"\n"}
                - Make sure the post is public or visible for at least 24 hours.{"\n"}
                - Don't delete your post before the reward is given.{"\n"}
                - Points will be credited after your submission is reviewed (usually within 24–48 hours).
              </Text>
            </ScrollView>

            {/* Share App Button */}
            <TouchableOpacity onPress={handleShare} style={styles.shareBtn}>
              <Text style={styles.shareBtnText}>📤 Share App</Text>
            </TouchableOpacity>

            {/* Platform Name Input (for "Other") */}
            {selectedPlatform?.name === 'Other' && (
              <TextInput
                placeholder="Platform Name"
                value={customPlatformName}
                onChangeText={setCustomPlatformName}
                style={styles.input}
              />
            )}

            {/* Link Input */}
            <TextInput
              placeholder="Paste your post link here"
              value={link}
              onChangeText={setLink}
              style={styles.input}
            />

            {/* Modal Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtnBig} onPress={handleSubmit}>
                <Text style={styles.submitText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
          </ConditionalKeyboardWrapper>

        </View>
      </Modal>


    </View>
  );
}


// 💄 Styles
const styles = StyleSheet.create({
  container: {
    padding: 8,
    // backgroundColor: '',
    borderRadius: 12,
    marginBottom: 10,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
    // backgroundColor: '#86A788',
    paddingHorizontal: 10,
    paddingVertical: 15,
    borderRadius: 20,
    flexWrap: 'wrap',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    marginHorizontal: 8,
    height: 35,
    width: 35
  },
  platformName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    color: '#F9FBE7',
  },
  pointsText: {
    color: '#F9FBE7',
    fontFamily: 'Lato-Bold',
    marginRight: 10,
    fontSize: 14,
  },
  submitBtn: {
    backgroundColor: '#626F47',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  submitText: {
    color: '#F9FBE7',
    fontFamily: 'Lato-Bold',
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    width: '95%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontFamily: 'Lato-Bold',
    fontSize: 18,
    paddingBottom: 12,
    textAlign: 'center',
  },
  scrollView: {
    maxHeight: 500,
  },
  stepText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    marginBottom: 10,
  },
  bold: {
    fontFamily: 'Lato-Bold',
  },
  rulesText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    marginTop: 20,
    color: 'red',
  },
  shareBtn: {
    backgroundColor: '#4CAF50',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    alignItems: 'center',
  },
  shareBtnText: {
    color: '#fff',
    fontFamily: 'Lato-Bold',
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelBtn: {
    padding: 10,
  },
  cancelText: {
    color: '#999',
    fontFamily: 'Lato-Bold',
  },
  submitBtnBig: {
    backgroundColor: '#2196f3',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  submitText: {
    color: '#fff',
    fontFamily: 'Lato-Bold',
    fontSize: 16,
  },
});
