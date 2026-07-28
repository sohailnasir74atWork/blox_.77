import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Image,
  Alert,
  Pressable,
} from 'react-native';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from '@react-native-firebase/firestore';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InterstitialAdManager from '../../Ads/IntAd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { validateContent } from '../../Helper/ContentModeration';
import RoleBadges from './RoleBadges';

dayjs.extend(relativeTime);

const CommentModal = ({ visible, onClose, postId }) => {
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const inputRef = useRef(null);
  const { user, theme, firestoreDB, strikeInfo, isAdmin, isUserBlocked } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isDarkMode = theme === 'dark';

  // Load comments — only while the modal is actually open. CommentModal is
  // rendered by every PostCard in the feed, so subscribing regardless of
  // `visible` opened one live listener per mounted card (unbounded reads that
  // grew as the user scrolled, for a modal usually never opened). Gate on
  // `visible` and bound the query so at most one bounded listener exists.
  useEffect(() => {
    if (!visible || !postId || !firestoreDB) return;

    const commentsRef = collection(firestoreDB, 'designPosts_upgrade', postId, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'desc'), limit(100));

    const unsubscribe = onSnapshot(q, snapshot => {
      const commentsData = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      }));
      setComments(commentsData);
    });

    return () => unsubscribe();
  }, [visible, postId, firestoreDB]);

  const handleChatNavigation = useCallback((comment) => {
    const callback = () => {
      if (!user?.id) {
        Alert.alert('Sign In Required', 'Please sign in to message');
        return;
      }

      navigation.navigate('PrivateChatDesign', {
        selectedUser: {
          senderId: comment.userId,
          sender: comment.displayName,
          avatar: comment.avatar,
        },
      });
    };

    try {
      callback();
    } catch (error) {
      console.error('Navigation Error:', error);
      Alert.alert('Error', 'Failed to navigate to chat.');
    }
  }, [user?.id, navigation, localState?.isPro]);

  const handleAddComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text || !firestoreDB || !user?.id) return;

    // Block banned users from commenting (admins are exempt). Defer the
    // expiry decision to the server-time-validated `isUserBlocked` flag from
    // GlobelStats so a clock-rolled device can't slip past — strikeInfo is
    // used only to compose the message text for an already-blocked user.
    if (isUserBlocked && !isAdmin) {
      const { strikeCount, bannedUntil } = strikeInfo || {};

      if (bannedUntil === 'permanent') {
        Alert.alert('⛔ Permanently Banned', 'You are permanently banned from commenting.');
        return;
      }

      if (typeof bannedUntil === 'number') {
        // Display countdown using device clock (cosmetic only). The block
        // decision above already used authoritative server time.
        const remaining = Math.max(0, bannedUntil - Date.now());
        const totalMinutes = Math.ceil(remaining / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        Alert.alert(
          `⚠️ Strike ${strikeCount ?? ''}`.trim(),
          `You are banned from commenting for ${timeLeftText} more minute(s).`
        );
        return;
      }

      Alert.alert('⛔ Banned', 'You are currently banned from commenting.');
      return;
    }

    // ✅ Content moderation: Check comment for inappropriate content
    const contentValidation = validateContent(text);
    if (!contentValidation.isValid) {
      Alert.alert('Content Not Allowed', contentValidation.reason || 'Your comment contains inappropriate content.');
      return;
    }

    const comment = {
      userId: user.id,
      displayName: user.displayName || 'Guest User',
      avatar: user.avatar,
      text,
      createdAt: serverTimestamp(),
    };

    try {
      const commentsRef = collection(firestoreDB, 'designPosts_upgrade', postId, 'comments');
      const postRef = doc(firestoreDB, 'designPosts_upgrade', postId);

      await addDoc(commentsRef, comment);
      await updateDoc(postRef, {
        commentCount: increment(1),
      });

      setCommentText('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Add Comment Error:', error);
      Alert.alert('Error', 'Failed to post comment. Please try again.');
    }
  }, [commentText, user, postId, firestoreDB]);

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      onPress={() => handleChatNavigation(item)}
      style={[styles.comment, isDarkMode && styles.commentDark]}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
        style={styles.avatar}
      />
      <View style={styles.commentContent}>
        <View style={styles.commentHeader}>
          <Text style={[styles.name, isDarkMode && styles.textDark]} numberOfLines={1}>
            {item.displayName || 'Anonymous'}
          </Text>
          <RoleBadges userItem={item} />
          {item.createdAt?.seconds && (
            <Text style={[styles.timestamp, isDarkMode && styles.timestampDark]}>
              {dayjs(item.createdAt.seconds * 1000).fromNow()}
            </Text>
          )}
        </View>
        <Text style={[styles.text, isDarkMode && styles.textDark]}>{item.text}</Text>
      </View>
    </TouchableOpacity>
  ), [isDarkMode, handleChatNavigation]);

  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyText, isDarkMode && styles.textDark]}>
        No comments yet. Be the first to comment!
      </Text>
    </View>
  ), [isDarkMode]);

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.overlay}
        onPress={onClose}
      />
      <ConditionalKeyboardWrapper style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' }}>

        <View style={[styles.drawer, isDarkMode && styles.drawerDark, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Handle Bar */}
          <View style={styles.handleContainer}>
            <View style={[styles.handleBar, isDarkMode && styles.handleBarDark]} />
          </View>

          {/* Header */}
          <View style={[styles.header, isDarkMode && styles.headerDark]}>
            <Text style={[styles.headerTitle, isDarkMode && styles.textDark]}>
              Comments ({comments.length})
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeIconButton, isDarkMode && styles.closeIconButtonDark]}
            >
              <Text style={[styles.closeIcon, isDarkMode && styles.textDark]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Comments List */}
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={ListEmptyComponent}
            showsVerticalScrollIndicator={false}
          />

          {/* Input Row */}
          <View style={[styles.inputContainer, isDarkMode && styles.inputContainerDark]}>
            <TextInput
              ref={inputRef}
              placeholder="Write a comment..."
              placeholderTextColor={isDarkMode ? '#9CA3AF' : '#6B7280'}
              value={commentText}
              onChangeText={setCommentText}
              style={[styles.input, isDarkMode && styles.inputDark]}
              returnKeyType="send"
              onSubmitEditing={handleAddComment}
              multiline
              maxLength={500}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              onPress={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAddComment();
              }}
              style={[
                styles.sendBtn,
                (!commentText.trim() || !user?.id) && styles.sendBtnDisabled
              ]}
              disabled={!commentText.trim() || !user?.id}
              activeOpacity={0.7}
            >
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ConditionalKeyboardWrapper>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    minHeight: 400,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 20,

  },
  drawerDark: {
    backgroundColor: '#1F2937',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  handleBarDark: {
    backgroundColor: '#4B5563',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    marginBottom: 12,
  },
  headerDark: {
    borderBottomColor: '#374151',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  closeIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIconButtonDark: {
    backgroundColor: '#374151',
  },
  closeIcon: {
    fontSize: 18,
    color: '#6B7280',
    fontWeight: 'bold',
  },
  listContent: {
    paddingBottom: 16,
    flexGrow: 1,
  },
  comment: {
    flexDirection: 'row',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  commentDark: {
    borderBottomColor: '#374151',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#E5E7EB',
  },
  commentContent: {
    flex: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  name: {
    fontWeight: 'bold',
    fontSize: 15,
    color: '#111827',
    flex: 1,
  },
  text: {

    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    marginTop: 4,
  },
  timestamp: {
    fontSize: 11,
    color: '#9CA3AF',

  },
  timestampDark: {
    color: '#6B7280',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    gap: 12,
    marginTop: 8,
  },
  inputContainerDark: {
    borderTopColor: '#374151',
    backgroundColor: '#1F2937',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    color: '#111827',

    fontSize: 14,
    maxHeight: 100,
    backgroundColor: '#fff',
  },
  inputDark: {
    borderColor: '#4B5563',
    color: '#F9FAFB',
    backgroundColor: '#374151',
  },
  sendBtn: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#9CA3AF',
    opacity: 0.6,
  },
  sendText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,

    color: '#9CA3AF',
    textAlign: 'center',
  },
  textDark: {
    color: '#F9FAFB',
  },
});

export default CommentModal;
