import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { createGroup, updateGroupName, updateGroupDescription, updateGroupAvatar } from '../utils/groupUtils';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';

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

const MAX_GROUP_MEMBERS = 50;

const CreateGroupModal = ({ visible, onClose, selectedUsers = [], editGroupId = null, editGroupName = null, editGroupDescription = null, editGroupAvatar = null, isAdmin = false, onGroupUpdated = null }) => {
  const { theme, user, firestoreDB, appdatabase } = useGlobalState();
  const isEditMode = !!editGroupId;
  const { triggerHapticFeedback } = useHaptic();
  const navigation = useNavigation();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [groupAvatarUri, setGroupAvatarUri] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const previousVisibleRef = useRef(false);
  const initializedEditGroupIdRef = useRef(null);
  const hasInitializedSelectedUsersRef = useRef(false);

  // Initialize selectedMemberIds from selectedUsers when modal opens (only once per modal open)
  React.useEffect(() => {
    if (visible && !isEditMode) {
      // Only initialize once when modal opens
      if (!hasInitializedSelectedUsersRef.current) {
        const currentIds = selectedUsers.map((u) => u.id).filter((id) => id !== user?.id);
        setSelectedMemberIds(currentIds);
        hasInitializedSelectedUsersRef.current = true;
      }
    } else if (!visible) {
      // Reset flag when modal closes
      hasInitializedSelectedUsersRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isEditMode]); // Only depend on visible and isEditMode, not selectedUsers to avoid resetting when parent clears

  // Reset when modal closes
  React.useEffect(() => {
    if (!visible && previousVisibleRef.current) {
      // Modal just closed - reset everything
      setGroupName('');
      setGroupDescription('');
      setCreating(false);
      setSelectedMemberIds([]);
      setGroupAvatarUri(null);
      setUploadingAvatar(false);
      initializedEditGroupIdRef.current = null;
    }
    previousVisibleRef.current = visible;
  }, [visible]);

  // Initialize edit data when modal opens in edit mode (only once per group)
  React.useEffect(() => {
    if (!visible) return;
    
    if (isEditMode && editGroupId) {
      // Only initialize if we haven't initialized for this group yet
      if (initializedEditGroupIdRef.current !== editGroupId) {
        setGroupName(editGroupName || '');
        setGroupDescription(editGroupDescription || '');
        setGroupAvatarUri(editGroupAvatar || null);
        initializedEditGroupIdRef.current = editGroupId;
      }
    } else if (!isEditMode) {
      // Create mode - ensure fields are empty and reset ref
      if (initializedEditGroupIdRef.current !== null) {
        setGroupName('');
        setGroupDescription('');
        setGroupAvatarUri(null);
        initializedEditGroupIdRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isEditMode, editGroupId]); // Only depend on these to avoid loops

  // Upload image to BunnyCDN
  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      const base64 = await RNFS.readFile(imagePath.replace('file://', ''), 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const filePath = `groups/${fileName}`;

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

  // Handle image picker
  const handlePickImage = useCallback(() => {
    launchImageLibrary(
      {
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 0.8,
      },
      async (response) => {
        if (response.didCancel || response.errorCode) {
          return;
        }

        const asset = response.assets?.[0];
        if (asset?.uri) {
          setGroupAvatarUri(asset.uri);
        }
      }
    );
  }, []);

  // Filter out current user and get selected users
  const displayUsers = useMemo(() => {
    return selectedUsers.filter((u) => u.id !== user?.id);
  }, [selectedUsers, user?.id]);

  const handleRemoveUser = (userId) => {
    triggerHapticFeedback('impactLight');
    setSelectedMemberIds((prev) => prev.filter((id) => id !== userId));
  };

  // Handle submit (create or update)
  const handleSubmit = async () => {
    if (!user?.id || !firestoreDB || !appdatabase) {
      showErrorMessage('Error', 'Missing required data');
      return;
    }

    // Validate group name (required for both create and edit)
    if (!groupName.trim()) {
      showErrorMessage('Error', 'Group name is required');
      return;
    }

    if (isEditMode) {
      // Edit mode - only update name, description, and avatar
      await handleUpdateGroup();
    } else {
      // Create mode - validate members and create group
      await handleCreateGroup();
    }
  };

  // Handle create group
  const handleCreateGroup = async () => {
    // Validate description (required for create)
    if (!groupDescription.trim()) {
      showErrorMessage('Error', 'Group description is required');
      return;
    }

    // Validate member count
    const totalMembers = 1 + selectedMemberIds.length; // Creator + selected members
    if (totalMembers < 2) {
      showErrorMessage('Error', 'Select at least 1 member to create a group');
      return;
    }

    if (totalMembers > MAX_GROUP_MEMBERS) {
      showErrorMessage('Error', `Maximum ${MAX_GROUP_MEMBERS} members allowed`);
      return;
    }

    setCreating(true);
    triggerHapticFeedback('impactMedium');

    try {
      // Upload group avatar if selected
      let groupAvatarUrl = null;
      if (groupAvatarUri) {
        setUploadingAvatar(true);
        try {
          groupAvatarUrl = await uploadToBunny(groupAvatarUri);
        } catch (error) {
          console.error('Error uploading group avatar:', error);
          showErrorMessage('Error', 'Failed to upload group icon. Creating group without icon...');
        } finally {
          setUploadingAvatar(false);
        }
      }

      // ✅ Build user data map from selectedUsers to avoid extra Firestore read
      const invitedUsersMap = {};
      displayUsers.forEach((u) => {
        if (u.id && selectedMemberIds.includes(u.id)) {
          invitedUsersMap[u.id] = {
            displayName: u.displayName || 'Anonymous',
            avatar: u.avatar || null,
          };
        }
      });

      const result = await createGroup(
        firestoreDB,
        appdatabase,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        },
        selectedMemberIds,
        groupName.trim(),
        invitedUsersMap, // ✅ Pass user data to avoid extra Firestore read
        groupAvatarUrl, // Pass group avatar URL
        groupDescription.trim() // Pass group description
      );

      if (result.success) {
        showSuccessMessage('Success', 'Group created successfully!');
        onClose();
        // Navigate to group chat
        if (result.groupId && navigation && typeof navigation.navigate === 'function') {
          navigation.navigate('GroupChatDetail', {
            groupId: result.groupId,
            groupName: groupName.trim() || 'Group',
          });
        }
      } else {
        showErrorMessage('Error', result.error || 'Failed to create group');
      }
    } catch (error) {
      console.error('Error creating group:', error);
      showErrorMessage('Error', 'Failed to create group. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  // Handle update group (edit mode)
  const handleUpdateGroup = async () => {
    if (!editGroupId) {
      showErrorMessage('Error', 'Group ID is missing');
      return;
    }

    setCreating(true);
    triggerHapticFeedback('impactMedium');

    try {
      // Upload group avatar if a new one was selected
      let groupAvatarUrl = null;
      if (groupAvatarUri && groupAvatarUri !== editGroupAvatar) {
        // Only upload if it's a new image (different from the original)
        setUploadingAvatar(true);
        try {
          groupAvatarUrl = await uploadToBunny(groupAvatarUri);
        } catch (error) {
          console.error('Error uploading group avatar:', error);
          showErrorMessage('Error', 'Failed to upload group icon. Updating group without icon change...');
        } finally {
          setUploadingAvatar(false);
        }
      } else if (groupAvatarUri === editGroupAvatar) {
        // Same image, use existing URL
        groupAvatarUrl = editGroupAvatar;
      }

      // Update group name if changed
      if (groupName.trim() !== (editGroupName || '')) {
        const nameResult = await updateGroupName(
          firestoreDB,
          appdatabase,
          editGroupId,
          user.id,
          groupName.trim(),
          isAdmin
        );
        if (!nameResult.success) {
          showErrorMessage('Error', nameResult.error || 'Failed to update group name');
          setCreating(false);
          return;
        }
      }

      // Update group description if changed (max 100 chars)
      const trimmedDescription = groupDescription.trim().substring(0, 100);
      if (trimmedDescription !== (editGroupDescription || '')) {
        const descResult = await updateGroupDescription(
          firestoreDB,
          appdatabase,
          editGroupId,
          user.id,
          trimmedDescription,
          isAdmin
        );
        if (!descResult.success) {
          showErrorMessage('Error', descResult.error || 'Failed to update group description');
          setCreating(false);
          return;
        }
      }

      // Update group avatar if changed
      if (groupAvatarUrl !== null && groupAvatarUrl !== editGroupAvatar) {
        const avatarResult = await updateGroupAvatar(
          firestoreDB,
          appdatabase,
          editGroupId,
          user.id,
          groupAvatarUrl,
          isAdmin
        );
        if (!avatarResult.success) {
          showErrorMessage('Error', avatarResult.error || 'Failed to update group icon');
          setCreating(false);
          return;
        }
      }

      showSuccessMessage('Success', 'Group updated successfully!');
      if (onGroupUpdated && typeof onGroupUpdated === 'function') {
        onGroupUpdated();
      }
      onClose();
    } catch (error) {
      console.error('Error updating group:', error);
      showErrorMessage('Error', 'Failed to update group. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const totalMembers = 1 + selectedMemberIds.length;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <View style={styles.overlay}>
          <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>{isEditMode ? 'Edit Group' : 'Create Group'}</Text>
              <View style={styles.placeholder} />
            </View>

            {/* Group Icon Selection */}
            <View style={styles.avatarContainer}>
              <Text style={styles.label}>Group Icon (Optional)</Text>
              <TouchableOpacity
                onPress={handlePickImage}
                style={styles.avatarButton}
                disabled={uploadingAvatar}
              >
                {groupAvatarUri ? (
                  <Image source={{ uri: groupAvatarUri }} style={styles.avatarPreview} />
                ) : (
                  <View style={[styles.avatarPlaceholder, { backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5' }]}>
                    <Icon name="camera" size={32} color={isDarkMode ? '#666' : '#999'} />
                  </View>
                )}
                {uploadingAvatar && (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
                {groupAvatarUri && !uploadingAvatar && (
                  <TouchableOpacity
                    style={styles.removeAvatarButton}
                    onPress={() => setGroupAvatarUri(null)}
                  >
                    <Icon name="close-circle" size={20} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            </View>

            {/* Group Name Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Group Name <Text style={{ color: '#EF4444' }}>*</Text></Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
                    color: isDarkMode ? '#fff' : '#000',
                  },
                ]}
                placeholder="Enter group name (required)..."
                placeholderTextColor={isDarkMode ? '#666' : '#999'}
                value={groupName}
                onChangeText={setGroupName}
                maxLength={50}
              />
            </View>

            {/* Group Description Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>
                Description {!isEditMode && <Text style={{ color: '#EF4444' }}>*</Text>}
                {isEditMode && <Text style={{ fontSize: 12, color: isDarkMode ? '#9CA3AF' : '#6B7280' }}> (max 100 characters)</Text>}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
                    color: isDarkMode ? '#fff' : '#000',
                    minHeight: 80,
                    textAlignVertical: 'top',
                  },
                ]}
                placeholder={isEditMode ? "Enter group description (optional)..." : "Enter group description (required)..."}
                placeholderTextColor={isDarkMode ? '#666' : '#999'}
                value={groupDescription}
                onChangeText={setGroupDescription}
                multiline
                maxLength={isEditMode ? 100 : 200}
              />
            </View>

            {/* Selected Members Count - Only show in create mode */}
            {!isEditMode && (
              <>
                <View style={styles.memberCountContainer}>
                  <Text style={styles.memberCountText}>
                    {selectedMemberIds.length} member{selectedMemberIds.length !== 1 ? 's' : ''} selected
                    {totalMembers >= MAX_GROUP_MEMBERS && (
                      <Text style={styles.maxReachedText}> (Max reached)</Text>
                    )}
                  </Text>
                </View>

                {/* Selected Members List */}
                <FlatList
                  data={displayUsers.filter((u) => selectedMemberIds.includes(u.id))}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.memberItem}>
                      <Image
                        source={{
                          uri:
                            item.avatar ||
                            'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                        }}
                        style={styles.memberAvatar}
                      />
                      <Text style={styles.memberName} numberOfLines={1}>
                        {item.displayName || 'Anonymous'}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleRemoveUser(item.id)}
                        style={styles.removeButton}
                      >
                        <Icon name="close-circle" size={24} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  )}
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <Text style={styles.emptyText}>No members selected</Text>
                    </View>
                  }
                  style={styles.membersList}
                />
              </>
            )}

            {/* Create Button */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.createButton,
                (creating || (!isEditMode && (totalMembers < 2 || totalMembers > MAX_GROUP_MEMBERS || !groupName.trim() || !groupDescription.trim())) || (isEditMode && !groupName.trim())) &&
                  styles.createButtonDisabled,
              ]}
              onPress={handleSubmit}
                disabled={creating || uploadingAvatar || (!isEditMode && (totalMembers < 2 || totalMembers > MAX_GROUP_MEMBERS || !groupName.trim() || !groupDescription.trim())) || (isEditMode && !groupName.trim())}
              >
                {(creating || uploadingAvatar) ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Icon name={isEditMode ? "checkmark" : "people"} size={20} color="#fff" />
                    <Text style={styles.createButtonText}>{isEditMode ? 'Update Group' : 'Create Group'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    keyboardAvoidingView: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    container: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      maxHeight: '90%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    closeButton: {
      padding: 4,
    },
    headerTitle: {
      fontSize: 20,
      fontFamily: 'Lato-Bold',
      color: isDark ? '#fff' : '#000',
    },
    placeholder: {
      width: 32,
    },
    avatarContainer: {
      marginBottom: 16,
      alignItems: 'center',
    },
    avatarButton: {
      position: 'relative',
      width: 100,
      height: 100,
      borderRadius: 50,
      overflow: 'hidden',
      marginTop: 8,
    },
    avatarPreview: {
      width: 100,
      height: 100,
      borderRadius: 50,
    },
    avatarPlaceholder: {
      width: 100,
      height: 100,
      borderRadius: 50,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: isDark ? '#444' : '#ddd',
      borderStyle: 'dashed',
    },
    uploadingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 50,
    },
    removeAvatarButton: {
      position: 'absolute',
      top: -5,
      right: -5,
      backgroundColor: '#fff',
      borderRadius: 12,
    },
    inputContainer: {
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontFamily: 'Lato-SemiBold',
      color: isDark ? '#fff' : '#000',
      marginBottom: 8,
    },
    input: {
      borderRadius: 12,
      padding: 12,
      fontSize: 16,
      fontFamily: 'Lato-Regular',
    },
    memberCountContainer: {
      marginBottom: 12,
    },
    memberCountText: {
      fontSize: 14,
      fontFamily: 'Lato-SemiBold',
      color: isDark ? '#9ca3af' : '#6b7280',
    },
    maxReachedText: {
      color: '#EF4444',
    },
    membersList: {
      maxHeight: 300,
      marginBottom: 16,
    },
    memberItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5',
      borderRadius: 12,
      marginBottom: 8,
    },
    memberAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginRight: 12,
    },
    memberName: {
      flex: 1,
      fontSize: 16,
      fontFamily: 'Lato-Regular',
      color: isDark ? '#fff' : '#000',
    },
    removeButton: {
      padding: 4,
    },
    emptyContainer: {
      padding: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      color: isDark ? '#666' : '#999',
    },
    footer: {
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: isDark ? '#333' : '#e5e7eb',
    },
    createButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#8B5CF6',
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    createButtonDisabled: {
      backgroundColor: '#6b7280',
      opacity: 0.6,
    },
    createButtonText: {
      fontSize: 16,
      fontFamily: 'Lato-Bold',
      color: '#fff',
    },
  });

export default CreateGroupModal;

