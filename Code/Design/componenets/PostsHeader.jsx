import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';

const TAG_CONFIG = {
  'Scam Alert': { icon: 'shield-halved', color: '#EF4444' },
  'Looking for Trade': { icon: 'handshake', color: '#10B981' },
  'Discussion': { icon: 'comments', color: '#3B82F6' },
  'Real or Fake': { icon: 'magnifying-glass', color: '#8B5CF6' },
  'Need Help': { icon: 'circle-question', color: '#F59E0B' },
  'Misc': { icon: 'ellipsis', color: '#6B7280' },
};

// Sort mode configuration
const SORT_MODES = [
  { key: 'latest', icon: 'clock', color: null },
  { key: 'hot', icon: 'fire-flame-curved', color: '#F97316' },
  { key: 'trending', icon: 'arrow-trend-up', color: '#10B981' },
];

const PostsHeader = ({
  selectedTag,
  filterMyPosts,
  setFilterMyPosts,
  filterFollowing,
  setFilterFollowing,
  setSelectedTag,
  fetchInitialPosts,
  fetchMyPosts,
  fetchFollowingPosts,
  fetchPostsByTag,
  activeSort = 'latest',
  onSortChange,
}) => {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  const availableTags = [
    { label: t('feed.tags.scam_alert', { defaultValue: 'Scam Alert' }), value: 'Scam Alert' },
    { label: t('feed.tags.looking_for_trade', { defaultValue: 'Looking for Trade' }), value: 'Looking for Trade' },
    { label: t('feed.tags.discussion', { defaultValue: 'Discussion' }), value: 'Discussion' },
    { label: t('feed.tags.real_or_fake', { defaultValue: 'Real or Fake' }), value: 'Real or Fake' },
    { label: t('feed.tags.need_help', { defaultValue: 'Need Help' }), value: 'Need Help' },
    { label: t('feed.tags.misc', { defaultValue: 'Misc' }), value: 'Misc' },
  ];

  const handleSelectTag = (value) => {
    if (selectedTag === value) {
      setFilterMyPosts(false);
      setFilterFollowing?.(false);
      setSelectedTag(null);
      fetchInitialPosts();
    } else {
      setFilterMyPosts(false);
      setFilterFollowing?.(false);
      setSelectedTag(value);
      fetchPostsByTag(value);
    }
  };

  const handleMyPosts = () => {
    if (filterMyPosts) {
      setFilterMyPosts(false);
      setSelectedTag(null);
      fetchInitialPosts();
    } else {
      setFilterMyPosts(true);
      setFilterFollowing?.(false);
      setSelectedTag(null);
      fetchMyPosts();
    }
  };

  const handleFollowing = () => {
    if (filterFollowing) {
      setFilterFollowing(false);
      setSelectedTag(null);
      fetchInitialPosts();
    } else {
      setFilterFollowing(true);
      setFilterMyPosts(false);
      setSelectedTag(null);
      fetchFollowingPosts?.();
    }
  };

  const handleSortChange = (sortKey) => {
    if (!onSortChange) return;
    setFilterMyPosts(false);
    setFilterFollowing?.(false);
    setSelectedTag(null);
    onSortChange(sortKey);
  };

  const sortLabels = {
    latest: t('feed.latest', { defaultValue: 'Latest' }),
    hot: t('feed.hot', { defaultValue: 'Hot' }),
    trending: t('feed.trending', { defaultValue: 'Trending' }),
  };

  const followingColor = '#8B5CF6';

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[
        styles.tabBarScroll,
        { backgroundColor: isDark ? '#0f172a' : '#fff', borderBottomColor: isDark ? '#1e293b' : '#e8e8f0' }
      ]}
      contentContainerStyle={styles.tabBar}
    >
      {/* ── Sort Modes: Latest / Hot / Trending ── */}
      {SORT_MODES.map(({ key, icon, color }) => {
        const isActive = activeSort === key && !filterMyPosts && !filterFollowing && !selectedTag;
        const activeColor = color || config.colors.primary;
        const inactiveColor = isDark ? '#64748b' : '#94a3b8';

        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.sortTab,
              isActive && {
                backgroundColor: activeColor + '18',
                borderColor: activeColor + '40',
                borderWidth: 1.5,
              },
            ]}
            onPress={() => handleSortChange(key)}
            activeOpacity={0.75}
          >
            <FontAwesome6
              name={icon}
              size={12}
              color={isActive ? activeColor : inactiveColor}
              solid
            />
            <Text
              style={[
                styles.sortTabText,
                { color: inactiveColor },
                isActive && { color: activeColor, fontWeight: '800' },
              ]}
            >
              {sortLabels[key]}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* ── Separator ── */}
      <View style={[styles.separator, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} />

      {/* My Posts */}
      <TouchableOpacity
        style={[
          styles.tab,
          filterMyPosts && {
            backgroundColor: config.colors.primary + '18',
            borderColor: config.colors.primary + '40',
            borderWidth: 1.5,
          },
        ]}
        onPress={handleMyPosts}
        activeOpacity={0.8}
      >
        <FontAwesome6 name="user" size={11} color={filterMyPosts ? config.colors.primary : isDark ? '#64748b' : '#94a3b8'} solid />
        <Text style={[styles.tabText, { color: isDark ? '#64748b' : '#94a3b8' }, filterMyPosts && { color: config.colors.primary, fontWeight: '800' }]}>
          {t('feed.my_posts', { defaultValue: 'My Posts' })}
        </Text>
      </TouchableOpacity>

      {/* Following */}
      <TouchableOpacity
        style={[
          styles.tab,
          filterFollowing && {
            backgroundColor: followingColor + '18',
            borderColor: followingColor + '40',
            borderWidth: 1.5,
          },
        ]}
        onPress={handleFollowing}
        activeOpacity={0.8}
      >
        <FontAwesome6 name="user-group" size={11} color={filterFollowing ? followingColor : isDark ? '#64748b' : '#94a3b8'} solid />
        <Text style={[styles.tabText, { color: isDark ? '#64748b' : '#94a3b8' }, filterFollowing && { color: followingColor, fontWeight: '800' }]}>
          {t('feed.following', { defaultValue: 'Following' })}
        </Text>
      </TouchableOpacity>

      {/* ── Separator ── */}
      <View style={[styles.separator, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} />

      {/* Tag pills */}
      {availableTags.map(({ label, value }) => {
        const cfg = TAG_CONFIG[value] || { icon: 'tag', color: config.colors.primary };
        const isActive = selectedTag === value;
        return (
          <TouchableOpacity
            key={value}
            style={[
              styles.tab,
              isActive && {
                backgroundColor: cfg.color + '18',
                borderColor: cfg.color + '40',
                borderWidth: 1.5,
              },
            ]}
            onPress={() => handleSelectTag(value)}
            activeOpacity={0.8}
          >
            <FontAwesome6
              name={cfg.icon}
              size={11}
              color={isActive ? cfg.color : isDark ? '#64748b' : '#94a3b8'}
              solid
            />
            <Text style={[
              styles.tabText,
              { color: isDark ? '#64748b' : '#94a3b8' },
              isActive && { color: cfg.color, fontWeight: '800' },
            ]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  tabBarScroll: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 5,
    alignItems: 'center',
  },
  sortTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sortTabText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: {
    fontSize: 10,
    fontWeight: '700',
  },
  separator: {
    width: 1,
    height: 20,
    borderRadius: 999,
    marginHorizontal: 2,
  },
});

export default PostsHeader;
