import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState, modGateText } from '../../GlobelStats';
import { createGroup, updateGroupName, updateGroupDescription, updateGroupAvatar } from '../utils/groupUtils';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import { uploadImage, UPLOAD_KIND } from '../../Helper/imageUpload';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FramedAvatar from './FramedAvatar';
import { getCachedProfile } from '../../Helper/profileCache';
import { useTranslation } from 'react-i18next';

const MAX_GROUP_MEMBERS = 100;

const CreateGroupModal = ({ visible, onClose, selectedUsers = [], editGroupId = null, editGroupName = null, editGroupDescription = null, editGroupAvatar = null, isAdmin = false, onGroupUpdated = null }) => {
  const { theme, user, firestoreDB, appdatabase, getModGate } = useGlobalState();
  const isEditMode = !!editGroupId;
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const navigation = useNavigation();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const insets = useSafeAreaInsets();

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

  // Upload image (server-side, Helper/imageUpload.js); stored under groups/ as before
  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      return await uploadImage(imagePath, UPLOAD_KIND.group);
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

  // Memoize filtered member list so FlatList doesn't re-render on every parent render
  const selectedMembersList = useMemo(() => {
    return displayUsers.filter((u) => selectedMemberIds.includes(u.id));
  }, [displayUsers, selectedMemberIds]);

  const handleRemoveUser = (userId) => {
    triggerHapticFeedback('impactLight');
    setSelectedMemberIds((prev) => prev.filter((id) => id !== userId));
  };

  // Handle submit (create or update)
  const handleSubmit = async () => {
    if (!user?.id || !firestoreDB || !appdatabase) {
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.missing_data'));
      return;
    }

    // Groups are a chat surface: banned AND muted users can't create or edit
    // them (admins exempt; waits for the ban check on a fresh sign-in).
    const modGate = getModGate('chat');
    if (modGate) {
      const { title, message } = modGateText(modGate, 'group');
      showErrorMessage(title, message);
      return;
    }

    // Validate group name (required for both create and edit)
    if (!groupName.trim()) {
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.name_required'));
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
    // Ban / mute gate lives in handleSubmit (covers create and edit).
    // Validate description (required for create)
    if (!groupDescription.trim()) {
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.description_required'));
      return;
    }

    // Validate member count
    const totalMembers = 1 + selectedMemberIds.length; // Creator + selected members
    if (totalMembers < 2) {
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.select_member'));
      return;
    }

    if (totalMembers > MAX_GROUP_MEMBERS) {
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.max_members', { max: MAX_GROUP_MEMBERS }));
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
          showErrorMessage(t('chat.error'), t('chat.create_group_modal.icon_upload_failed_create'));
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
        showSuccessMessage(t('home.alert.success'), t('chat.create_group_modal.created'));
        onClose();
        // Navigate to group chat
        if (result.groupId && navigation && typeof navigation.navigate === 'function') {
          navigation.navigate('GroupChatDetail', {
            groupId: result.groupId,
            groupName: groupName.trim() || 'Group',
          });
        }
      } else {
        showErrorMessage(t('chat.error'), result.error || t('chat.create_group_modal.create_failed'));
      }
    } catch (error) {
      console.error('Error creating group:', error);
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.create_failed_retry'));
    } finally {
      setCreating(false);
    }
  };

  // Handle update group (edit mode)
  const handleUpdateGroup = async () => {
    if (!editGroupId) {
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.group_id_missing'));
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
          showErrorMessage(t('chat.error'), t('chat.create_group_modal.icon_upload_failed_update'));
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
          showErrorMessage(t('chat.error'), nameResult.error || t('chat.create_group_modal.update_name_failed'));
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
          showErrorMessage(t('chat.error'), descResult.error || t('chat.create_group_modal.update_description_failed'));
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
          showErrorMessage(t('chat.error'), avatarResult.error || t('chat.create_group_modal.update_icon_failed'));
          setCreating(false);
          return;
        }
      }

      showSuccessMessage(t('home.alert.success'), t('chat.create_group_modal.updated'));
      if (onGroupUpdated && typeof onGroupUpdated === 'function') {
        onGroupUpdated();
      }
      onClose();
    } catch (error) {
      console.error('Error updating group:', error);
      showErrorMessage(t('chat.error'), t('chat.create_group_modal.update_failed_retry'));
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
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoidingView}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff', paddingBottom: Math.max(insets.bottom, 16) }]}>
            {/* Header (sticky — sits above the scroll body) */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>{isEditMode ? t('chat.create_group_modal.edit_title') : t('chat.create_group_modal.create_title')}</Text>
              <View style={styles.placeholder} />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
            {/* Group Icon Selection */}
            <View style={styles.avatarContainer}>
              <Text style={styles.label}>{t('chat.create_group_modal.icon_label')}</Text>
              <TouchableOpacity
                onPress={handlePickImage}
                style={styles.avatarButton}
                disabled={uploadingAvatar}
              >
                {groupAvatarUri ? (
                  <Image resizeMethod="resize" source={{ uri: groupAvatarUri }} style={styles.avatarPreview} />
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
              <Text style={styles.label}>{t('chat.create_group_modal.name_label')} <Text style={{ color: '#EF4444' }}>*</Text></Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
                    color: isDarkMode ? '#fff' : '#000',
                  },
                ]}
                placeholder={t('chat.create_group_modal.name_placeholder')}
                placeholderTextColor={isDarkMode ? '#666' : '#999'}
                value={groupName}
                onChangeText={setGroupName}
                maxLength={50}
              />
            </View>

            {/* Group Description Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>
                {t('chat.create_group_modal.description_label')} {!isEditMode && <Text style={{ color: '#EF4444' }}>*</Text>}
                {isEditMode && <Text style={{ fontSize: 12, color: isDarkMode ? '#9CA3AF' : '#6B7280' }}> {t('chat.create_group_modal.description_max')}</Text>}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
                    color: isDarkMode ? '#fff' : '#000',
                    height: 80,
                    textAlignVertical: 'top',
                  },
                ]}
                placeholder={isEditMode ? t('chat.create_group_modal.description_placeholder_optional') : t('chat.create_group_modal.description_placeholder_required')}
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
                    {t('chat.create_group_modal.members_selected', { count: selectedMemberIds.length })}
                    {totalMembers >= MAX_GROUP_MEMBERS && (
                      <Text style={styles.maxReachedText}> {t('chat.create_group_modal.max_reached')}</Text>
                    )}
                  </Text>
                </View>

                {/* Selected Members List — rendered inline (not FlatList) because
                    we're inside a ScrollView. Bounded to MAX_GROUP_MEMBERS (100). */}
                <View style={styles.membersList}>
                  {selectedMembersList.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <Text style={styles.emptyText}>{t('chat.create_group_modal.no_members')}</Text>
                    </View>
                  ) : (
                    selectedMembersList.map((item) => (
                      <View key={item.id} style={styles.memberItem}>
                        <View style={{ marginRight: 12 }}>
                          <FramedAvatar
                            avatarUri={
                              item.avatar ||
                              'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'
                            }
                            frame={item.profileFrame || getCachedProfile(item.id)?.profileFrame || null}
                            isDarkMode={isDarkMode}
                            avatarSize={40}
                          />
                        </View>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {item.displayName || t('chat.anonymous')}
                        </Text>
                        <TouchableOpacity
                          onPress={() => handleRemoveUser(item.id)}
                          style={styles.removeButton}
                        >
                          <Icon name="close-circle" size={24} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
              </>
            )}

            </ScrollView>

            {/* Create Button — pinned outside the scroll body so it never gets pushed off-screen */}
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
                    <Text style={styles.createButtonText}>{isEditMode ? t('chat.create_group_modal.update_button') : t('chat.create_group_modal.create_title')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
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
      paddingTop: 20,
      paddingHorizontal: 20,
      height: '90%',
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
      fontWeight: 'bold',
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
      fontWeight: '600',
      color: isDark ? '#fff' : '#000',
      marginBottom: 8,
    },
    input: {
      borderRadius: 12,
      padding: 12,
      fontSize: 16,

    },
    memberCountContainer: {
      marginBottom: 12,
    },
    memberCountText: {
      fontSize: 14,
      fontWeight: '600',
      color: isDark ? '#9ca3af' : '#6b7280',
    },
    maxReachedText: {
      color: '#EF4444',
    },
    membersList: {
      // No maxHeight — parent ScrollView handles overflow now that
      // this list lives inline (was a FlatList previously).
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
      fontWeight: 'bold',
      color: '#fff',
    },
  });

export default CreateGroupModal;

