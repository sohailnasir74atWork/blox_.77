import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  useColorScheme,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { useNavigation } from '@react-navigation/native';
import InterstitialAdManager from '../../Ads/IntAd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const CommentModal = ({ visible, onClose, postId }) => {
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const inputRef = useRef(null);
  const { user, theme } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const isDarkMode = theme === 'dark';

  useEffect(() => {
    if (!postId) return;

    const unsubscribe = firestore()
      .collection('designPosts')
      .doc(postId)
      .collection('comments')
      .orderBy('createdAt', 'desc')
      .onSnapshot(snapshot => {
        const commentsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setComments(commentsData);
      });

    return () => unsubscribe();
  }, [postId]);

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
      if (!localState?.isPro) {
        InterstitialAdManager.showAd(callback);
      } else {
        callback();
      }
    } catch (error) {
      console.error('Navigation Error:', error);
      Alert.alert('Error', 'Failed to navigate to chat.');
    }
  }, [user?.id, navigation, localState?.isPro]);

  const handleAddComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text) return;

    const comment = {
      userId: user.id,
      displayName: user.displayName || 'Guest User',
      avatar: user.avatar,
      text,
      createdAt: firestore.FieldValue.serverTimestamp(),
    };

    try {
      const postRef = firestore().collection('designPosts').doc(postId);

      await postRef.collection('comments').add(comment);
      await postRef.update({
        commentCount: firestore.FieldValue.increment(1),
      });

      setCommentText('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Add Comment Error:', error);
      Alert.alert('Error', 'Failed to post comment. Please try again.');
    }
  }, [commentText, user, postId]);

  const renderItem = ({ item }) => (
    <TouchableOpacity onPress={() => handleChatNavigation(item)} style={styles.comment}>
      <Image source={{ uri: item.avatar }} style={styles.avatar} />
      <View style={{flex:1}}>
        <Text style={[styles.name, isDarkMode && styles.textDark]}>{item.displayName}</Text>
        {item.createdAt?.seconds && (
          <Text style={[styles.timestamp, isDarkMode && styles.textDark]}>
            {dayjs(item.createdAt.seconds * 1000).fromNow()}
          </Text>
        )}
        <Text style={[styles.text, isDarkMode && styles.textDark]}>{item.text}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalBackground}>
        <View style={[styles.modalContent, isDarkMode && styles.darkContent]}>
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
          />

          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              placeholder="Write a comment..."
              placeholderTextColor={isDarkMode ? '#ccc' : '#888'}
              value={commentText}
              onChangeText={setCommentText}
              style={[styles.input, isDarkMode && styles.inputDark]}
              returnKeyType="send"
              onSubmitEditing={handleAddComment}
            />
            <TouchableOpacity onPress={handleAddComment} style={styles.sendBtn}>
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.sendText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 10,
    padding: 10,
    maxHeight: '80%',
  },
  darkContent: {
    backgroundColor: '#1e1e1e',
  },
  comment: {
    flexDirection: 'row',
    marginBottom: 10,
    
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 10,
  },
  name: {
    fontFamily: 'Lato-Bold',
    fontSize: 14,
    color: '#000',
  },
  text: {
    fontFamily: 'Lato-Regular',
    fontSize: 13,
    color: '#333',
    flex:1,
    flexWrap:'wrap'
  },
  timestamp: {
    fontSize: 10,
    color: 'gray',
    fontFamily: 'Lato-Regular',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 8,
    borderRadius: 5,
    color: '#000',
    fontFamily: 'Lato-Regular',
  },
  inputDark: {
    borderColor: '#555',
    color: '#fff',
    backgroundColor: '#333',
  },
  sendBtn: {
    backgroundColor: '#007AFF',
    padding: 10,
    marginLeft: 5,
    borderRadius: 5,
  },
  closeBtn: {
    marginTop: 10,
    backgroundColor: '#FF3B30',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  sendText: {
    color: '#fff',
    fontWeight: '600',
    fontFamily: 'Lato-Bold',
  },
  textDark: {
    color: '#fff',
  },
});

export default CommentModal;
