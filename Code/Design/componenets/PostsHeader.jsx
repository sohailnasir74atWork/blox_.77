import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';

const availableTags = ['Scam Alert', 'Looking for Trade', 'Discussion', 'Real or Fake', 'Need Help', 'Misc'];

const PostsHeader = ({
  selectedTag,
  filterMyPosts,
  setFilterMyPosts,
  setSelectedTag,
  fetchInitialPosts,
  fetchMyPosts,
  fetchPostsByTag,
}) => {
  const { theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';

  return (
    <Menu>
      <MenuTrigger style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
        <Text style={{ color: config.colors.primary, fontSize: 10, fontWeight: '900', marginRight: 4 }}>
          {selectedTag || ''}
        </Text>
        <FontAwesome
          name="filter"
          size={20}
          style={{ padding: 6 }}
          color={filterMyPosts || selectedTag ? config.colors.primary : isDarkMode ? '#ccc' : '#444'}
        />
      </MenuTrigger>
      <MenuOptions customStyles={{ optionsContainer: { width: 200 } }}>
        {/* All Posts */}
        <MenuOption
          onSelect={() => {
            const handleAction = () => {
              setFilterMyPosts(false);
              setSelectedTag(null);
              fetchInitialPosts();
            };

            if (!localState.isPro) {
              InterstitialAdManager.showAd(handleAction);
            } else {
              handleAction();
            }
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 14, color: !filterMyPosts && !selectedTag ? config.colors.primary : '#333', fontFamily: !filterMyPosts && !selectedTag ? 'Lato-Bold' : 'Lato-Regular' }}>
              All Posts
            </Text>
            {!filterMyPosts && !selectedTag && <FontAwesome name="check" size={14} color={config.colors.primary} />}
          </View>
        </MenuOption>

        {/* My Posts */}
        <MenuOption
          onSelect={() => {
            const handleAction = () => {
              setFilterMyPosts(true);
              setSelectedTag(null);
              fetchMyPosts();
            };

            if (!localState.isPro) {
              InterstitialAdManager.showAd(handleAction);
            } else {
              handleAction();
            }
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 14, color: filterMyPosts ? config.colors.primary : '#333', fontFamily: filterMyPosts ? 'Lato-Bold' : 'Lato-Regular' }}>
              My Posts
            </Text>
            {filterMyPosts && <FontAwesome name="check" size={14} color={config.colors.primary} />}
          </View>
        </MenuOption>

        {/* Divider & Label */}
        <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, borderTopWidth: 1, borderColor: '#ccc' }}>
          <Text style={{ fontWeight: 'bold', fontSize: 12, color: isDarkMode ? '#aaa' : '#444', fontFamily: 'Lato-Bold' }}>
            Filter by Tag
          </Text>
        </View>

        {/* Tag Filters */}
        {availableTags.map((tag, index) => (
          <MenuOption
            key={index}
            onSelect={() => {
              const handleAction = () => {
                setFilterMyPosts(false);
                setSelectedTag(tag);
                fetchPostsByTag(tag);
              };
              if (!localState.isPro) {
                InterstitialAdManager.showAd(handleAction);
              } else {
                handleAction();
              }
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: 14, color: selectedTag === tag ? config.colors.primary : '#333', fontFamily: selectedTag === tag ? 'Lato-Bold' : 'Lato-Regular' }}>
                {tag}
              </Text>
              {selectedTag === tag && (
                <FontAwesome name="check" size={14} color={config.colors.primary} />
              )}
            </View>
          </MenuOption>
        ))}
      </MenuOptions>
    </Menu>
  );
};

export default PostsHeader;

