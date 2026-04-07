import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { getThemeColors } from '../../Helper/themeColors';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';

/**
 * ProfilePostsSection — Shows user's recent posts with pagination
 */
const ProfilePostsSection = ({ isDarkMode, t, posts, loadingPosts, hasMorePosts, handleLoadMorePosts, renderPostItem }) => {
  const c = getThemeColors(isDarkMode);

  return (
    <View
      style={{
        borderRadius: 14,
        padding: 12,
        backgroundColor: c.bgAlt,
        marginBottom: 8,
      }}
    >
      {/* Section Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <View style={{
          width: 24, height: 24, borderRadius: 8,
          backgroundColor: isDarkMode ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="images" size={12} color="#3b82f6" />
        </View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>
          {t('profile.recent_posts') || 'Recent Posts'}
        </Text>
        {posts?.length > 0 && (
          <View style={{
            backgroundColor: c.border,
            paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999,
            marginLeft: 4,
          }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: c.textSecondary }}>
              {posts.length}
            </Text>
          </View>
        )}
      </View>

      {loadingPosts && (!posts || posts.length === 0) ? (
        <ActivityIndicator size="small" color={config.colors.primary} />
      ) : (!posts || posts.length === 0) ? (
        <Text style={{ fontSize: 11, color: c.textMuted, fontStyle: 'italic' }}>
          {t('profile.no_posts') || 'No posts yet.'}
        </Text>
      ) : (
        <>
          {posts.map((post) => renderPostItem(post))}

          {hasMorePosts && !loadingPosts && (
            <TouchableOpacity
              onPress={handleLoadMorePosts}
              style={{
                marginTop: 8,
                alignSelf: 'center',
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: c.textSecondary }}>
                {t('common.load_more') || 'Load more'}
              </Text>
            </TouchableOpacity>
          )}

          {loadingPosts && hasMorePosts && (
            <ActivityIndicator
              size="small"
              color={config.colors.primary}
              style={{ marginTop: 6, alignSelf: 'center' }}
            />
          )}
        </>
      )}
    </View>
  );
};

export default React.memo(ProfilePostsSection);
