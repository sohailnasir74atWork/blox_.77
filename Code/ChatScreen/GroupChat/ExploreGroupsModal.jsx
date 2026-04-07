import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { getAllGroups, sendJoinRequest } from '../utils/groupUtils';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import config from '../../Helper/Environment';

const ExploreGroupsModal = ({ visible, onClose }) => {
  const { firestoreDB, user } = useGlobalState();
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const insets = useSafeAreaInsets();

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' or 'recent'
  const [searchQuery, setSearchQuery] = useState('');
  const [sendingRequests, setSendingRequests] = useState(new Set());
  const [userGroups, setUserGroups] = useState([]);

  // Load user's existing groups to check membership
  useEffect(() => {
    if (!firestoreDB || !user?.id || !visible) return;

    const loadUserGroups = async () => {
      try {
        // This would ideally come from props or a global state
        // For now, we'll check membership in each group when rendering
        setUserGroups([]);
      } catch (error) {
        console.error('Error loading user groups:', error);
      }
    };

    loadUserGroups();
  }, [firestoreDB, user?.id, visible]);

  // Load groups
  const loadGroups = useCallback(async () => {
    if (!firestoreDB) return;

    setLoading(true);
    try {
      const result = await getAllGroups(firestoreDB, filter, searchQuery);
      if (result.success) {
        setGroups(result.groups || []);
      } else {
        showErrorMessage('Error', result.error || 'Failed to load groups');
      }
    } catch (error) {
      console.error('Error loading groups:', error);
      showErrorMessage('Error', 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, filter, searchQuery]);

  useEffect(() => {
    if (visible) {
      loadGroups();
    }
  }, [visible, filter, searchQuery, loadGroups]);

  // Handle send join request
  const handleSendJoinRequest = useCallback(async (groupId) => {
    if (!firestoreDB || !user?.id) {
      showErrorMessage('Error', 'You must be logged in to send a join request');
      return;
    }

    if (sendingRequests.has(groupId)) return; // Prevent duplicate requests

    setSendingRequests(prev => new Set(prev).add(groupId));

    try {
      const result = await sendJoinRequest(
        firestoreDB,
        groupId,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        }
      );

      if (result.success) {
        showSuccessMessage('Success', 'Join request sent! The group creator will review it.');
      } else {
        showErrorMessage('Error', result.error || 'Failed to send join request');
      }
    } catch (error) {
      console.error('Error sending join request:', error);
      showErrorMessage('Error', 'Failed to send join request');
    } finally {
      setSendingRequests(prev => {
        const newSet = new Set(prev);
        newSet.delete(groupId);
        return newSet;
      });
    }
  }, [firestoreDB, user, sendingRequests]);

  // Render group item
  const renderGroupItem = useCallback(({ item }) => {
    if (!item || !item.id) return null;

    const groupId = item.id;
    const groupName = item.groupName || 'Group';
    const groupDescription = item.description || '';
    const groupAvatar = item.avatar || null;
    const memberCount = item.memberCount || item.memberIds?.length || 0;
    const isFull = memberCount >= 20;
    const isMember = item.memberIds?.includes(user?.id);
    const isCreator = item.createdBy === user?.id;
    const isSending = sendingRequests.has(groupId);

    // Get creator info from group data
    const creatorId = item.createdBy;
    const creatorName = item.creatorDisplayName || item.members?.[creatorId]?.displayName || 'Unknown';

    return (
      <View style={styles.groupItem}>
        <Image
          source={groupAvatar ? { uri: groupAvatar } : require('../../../assets/groups.png')}
          style={styles.groupAvatar}
        />
        <View style={styles.groupInfo}>
          <Text style={styles.groupName} numberOfLines={1}>
            {groupName}
          </Text>
          {groupDescription ? (
            <Text style={styles.groupDescription} numberOfLines={2}>
              {groupDescription}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.creatorName}>
              {creatorName}
            </Text>
            <Text style={styles.metaSeparator}>•</Text>
            <Text style={styles.memberCount}>
              {memberCount}/20
            </Text>
          </View>
        </View>
        <View style={styles.actionContainer}>
          {isCreator ? (
            <Text style={styles.statusText}>Your Group</Text>
          ) : isMember ? (
            <Text style={styles.statusText}>Member</Text>
          ) : isFull ? (
            <Text style={styles.statusText}>Full</Text>
          ) : (
            <TouchableOpacity
              style={[styles.requestButton, isSending && styles.requestButtonDisabled]}
              onPress={() => handleSendJoinRequest(groupId)}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.requestButtonText}>Request</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }, [styles, user?.id, sendingRequests, handleSendJoinRequest]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Explore Groups</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Icon name="search" size={20} color={isDarkMode ? '#999' : '#666'} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by group name..."
              placeholderTextColor={isDarkMode ? '#999' : '#666'}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                <Icon name="close-circle" size={20} color={isDarkMode ? '#999' : '#666'} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filters */}
          <View style={styles.filtersContainer}>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'all' && styles.filterButtonActive]}
              onPress={() => setFilter('all')}
            >
              <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
                All Groups
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'recent' && styles.filterButtonActive]}
              onPress={() => setFilter('recent')}
            >
              <Text style={[styles.filterText, filter === 'recent' && styles.filterTextActive]}>
                Recent
              </Text>
            </TouchableOpacity>
          </View>

          {/* Groups List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={config.colors.primary} />
            </View>
          ) : groups.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {searchQuery ? 'No groups found matching your search' : 'No groups available'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={groups}
              keyExtractor={(item) => item.id}
              renderItem={renderGroupItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: isDarkMode ? '#1F2937' : '#fff',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '90%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB',
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
    },
    closeButton: {
      padding: 4,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 10,
      backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    searchIcon: {
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,

      color: isDarkMode ? '#fff' : '#000',
    },
    clearButton: {
      padding: 4,
    },
    filtersContainer: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      marginBottom: 12,
      gap: 6,
    },
    filterButton: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
    },
    filterButtonActive: {
      backgroundColor: config.colors.primary,
    },
    filterText: {
      fontSize: 11,
      fontWeight: 'bold',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
    },
    filterTextActive: {
      color: '#fff',
      fontWeight: 'bold',
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    groupItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB',
    },
    groupAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      marginRight: 10,
      backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
    },
    groupInfo: {
      flex: 1,
      minWidth: 0,
    },
    groupName: {
      fontSize: 14,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
      marginBottom: 3,
    },
    groupDescription: {
      fontSize: 11,

      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      marginBottom: 4,
      lineHeight: 14,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    creatorName: {
      fontSize: 10,

      color: isDarkMode ? '#9CA3AF' : '#6B7280',
    },
    metaSeparator: {
      fontSize: 10,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
    },
    memberCount: {
      fontSize: 10,

      color: isDarkMode ? '#9CA3AF' : '#6B7280',
    },
    actionContainer: {
      marginLeft: 8,
      justifyContent: 'center',
    },
    requestButton: {
      backgroundColor: config.colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      minWidth: 70,
      alignItems: 'center',
    },
    requestButtonDisabled: {
      opacity: 0.6,
    },
    requestButtonText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '600'
    },
    statusText: {
      fontSize: 10,

      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      textAlign: 'center',
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
    },
    emptyText: {
      fontSize: 14,

      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      textAlign: 'center',
    },
  });

export default ExploreGroupsModal;

