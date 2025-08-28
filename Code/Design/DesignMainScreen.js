import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Text,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import firestore from '@react-native-firebase/firestore';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';

import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import PostCard from './componenets/PostCard';
import UploadModal from './componenets/UploadModal';
import SignInDrawer from '../Firebase/SigninDrawer';
import config from '../Helper/Environment';
import { Platform } from 'react-native';
import BannerAdComponent from '../Ads/bannerAds';
import { showMessage } from 'react-native-flash-message';


const availableTags = ['Scam Alert', 'Looking for Trade', 'Discussion', 'Real or Fake', 'Need Help', 'Misc'];


const DesignFeedScreen = ({ route }) => {
  const { selectedTheme } = route.params;
  const { appdatabase, user, theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';

  const [modalVisible, setModalVisible] = useState(false);
  const [isSigninDrawerVisible, setSigninDrawerVisible] = useState(false);
  const [posts, setPosts] = useState([]);
  const [lastVisibleDoc, setLastVisibleDoc] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterMyPosts, setFilterMyPosts] = useState(false);
  const [myPosts, setMyPosts] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);


  // console.log('mainscreen')
  const fetchMyPosts = async (tag = null) => {
    if (!user?.id) return;
    // console.log('📦 Fetching My Posts...');
    setInitialLoading(true);
    try {
      let query = firestore()
        .collection('designPosts')
        .where('userId', '==', user.id)
        .orderBy('createdAt', 'desc');
  
      if (tag) {
        query = query.where('selectedTags', 'array-contains', tag);
      }
  
      const snapshot = await query.get();
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // console.log('✅ My Posts fetched:', data.length);
      setMyPosts(data);
      setHasMore(snapshot.docs.length > 0);
    } catch (err) {
      console.error('❌ Error fetching my posts:', err);
      showMessage({ message: 'Failed to fetch your posts', type: 'danger' });
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };
  




  const fetchPostsByTag = async (tag) => {
    try {
      setInitialLoading(true);

      const snapshot = await firestore()
        .collection('designPosts')
        .where('selectedTags', 'array-contains', tag)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Error fetching posts by tag:', err);
      showMessage({ message: 'Failed to fetch posts', type: 'danger' });
    } finally {
      setInitialLoading(false);
    }
  };


  const skeletonArray = useMemo(() => Array.from({ length: 5 }), []);
  const handleDeletePost = async (postId) => {
    try {
      await firestore().collection('designPosts').doc(postId).delete();
      setPosts(prev => prev.filter(p => p.id !== postId));
      showMessage({ message: 'Post deleted', type: 'success' });
    } catch (err) {
      showMessage({ message: 'Failed to delete post', type: 'danger' });
    }
  };



  const fetchInitialPosts = async () => {
    try {
      const snapshot = await firestore()
        .collection('designPosts')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Initial load error:', err);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInitialPosts();
  }, []);
  useEffect(() => {
    if (posts.length === 0) return;

    const unsubscribers = posts.map(post =>
      firestore()
        .collection('designPosts')
        .doc(post.id)
        .onSnapshot(doc => {
          if (doc.exists) {
            const updatedPost = { id: doc.id, ...doc.data() };
            setPosts(prev =>
              prev.map(p => (p.id === updatedPost.id ? updatedPost : p))
            );
          }
        })
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [JSON.stringify(posts.map(p => p.id))]); // Triggers when post IDs change

  const loadMorePosts = async () => {
    if (loadingMore || !hasMore || !lastVisibleDoc) return;

    setLoadingMore(true);
    try {
      let query = firestore()
        .collection('designPosts')
        .orderBy('createdAt', 'desc')
        .startAfter(lastVisibleDoc)
        .limit(10);

      if (selectedTag) {
        query = query.where('selectedTags', 'array-contains', selectedTag);
      }

      const snapshot = await query.get();
      const newPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(prev => [...prev, ...newPosts]);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 10);
    } catch (err) {
      console.error('Pagination load error:', err);
    } finally {
      setLoadingMore(false);
    }
  };


  const handleLike = async (post) => {
    const postRef = firestore().collection('designPosts').doc(post.id);
    const alreadyLiked = !!post.likes?.[user.id];

    await postRef.update({
      [`likes.${user.id}`]: alreadyLiked ? firestore.FieldValue.delete() : true,
    });
  };

  const handleUploadPost = async (desc, imageUrl, selectedTags, currentUserEmail) => {
    if (!user?.id) return;
    const post = {
      imageUrl,
      desc,
      userId: user.id,
      displayName: user.displayName,
      avatar: user.avatar,
      createdAt: firestore.FieldValue.serverTimestamp(),
      likes: {},
      selectedTags,
      email:currentUserEmail
    };
    await firestore().collection('designPosts').add(post);
  };

  const renderItem = ({ item, index }) => {
    if (initialLoading) {
      return <View style={[styles.skeletonPost, isDarkMode && { backgroundColor: '#444' }]} />;
    }

    return (
      <PostCard
        item={item}
        userId={user?.id}
        onLike={handleLike}
        localState={localState}
        appdatabase={appdatabase}
        onDelete={handleDeletePost}

      />
    );
  };

  const dataToRender = initialLoading
    ? skeletonArray
    : filterMyPosts
      ? myPosts
      : posts;

  const keyExtractor = (item, index) =>
    initialLoading ? `skeleton-${index}` : item?.id || `post-${index}`;

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <View style={[styles.header, isDarkMode && styles.headerDark, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <Text style={[styles.headerText, isDarkMode && styles.headerTextDark]}>Feed</Text>
        <Menu>
          <MenuTrigger style={{flexDirection:'row', alignItems:'center'}}>
          <Text style={{color:config.colors.primary, fontSize:10, fontWeight:'900'}}>{selectedTag}</Text>
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
                setFilterMyPosts(false);
                setSelectedTag(null);
                fetchInitialPosts();
              }}
            >
              <View style={styles.menuItem}>
                <Text style={[styles.menuText, !filterMyPosts && !selectedTag && styles.selectedText]}>
                  All Posts
                </Text>
                {!filterMyPosts && !selectedTag && <FontAwesome name="check" size={14} color={config.colors.primary} />}
              </View>
            </MenuOption>

            {/* My Posts */}
            <MenuOption
              onSelect={() => {
                setFilterMyPosts(true);
                setSelectedTag(null);
                fetchMyPosts();
              }}
            >
              <View style={styles.menuItem}>
                <Text style={[styles.menuText, filterMyPosts && styles.selectedText]}>
                  My Posts
                </Text>
                {filterMyPosts && <FontAwesome name="check" size={14} color={config.colors.primary} />}
              </View>
            </MenuOption>

            {/* Divider & Label */}
            <View style={styles.menuDivider}>
              <Text style={[styles.menuLabel, isDarkMode && { color: '#aaa' }]}>Filter by Tag</Text>
            </View>

            {/* Tag Filters */}
            {availableTags.map((tag, index) => (
              <MenuOption
                key={index}
                onSelect={() => {
                  setFilterMyPosts(false);
                  setSelectedTag(tag);
                  fetchPostsByTag(tag);
                }}
              >
                <View style={styles.menuItem}>
                  <Text style={[styles.menuText, selectedTag === tag && styles.selectedText]}>
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



      </View>


      <FlatList
        data={dataToRender}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          fetchInitialPosts();
        }}
        ListFooterComponent={
          loadingMore && !initialLoading ? (
            <ActivityIndicator size="small" color={config.colors.primary} />
          ) : null
        }
        ListEmptyComponent={
          !initialLoading && (
            <Text style={{ textAlign: 'center', padding: 20, color: isDarkMode ? '#ccc' : '#666' }}>
              {filterMyPosts
                ? "You don't have any posts in the loaded data."
                : "No posts found."}
            </Text>
          )
        }

      />

      {/* <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)
        }
      >
        <Icon name="plus" size={24} color="white" />
      </TouchableOpacity> */}
      <TouchableOpacity style={styles.fab} onPress={() =>
        user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)
      }>
        <FontAwesome name="circle-plus" size={44} color={config.colors.primary} />
      </TouchableOpacity>

      <UploadModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onUpload={handleUploadPost}
        user={user}
      />

      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={() => setSigninDrawerVisible(false)}
        selectedTheme={selectedTheme}
        screen="Design"
        message="Sign in to upload designs"
      />
      {!localState.isPro && <BannerAdComponent />}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor: '#fff',
    paddingTop: Platform.OS === 'android' ? 60 : 0

  },
  darkContainer: {
    backgroundColor: '#121212',
    paddingTop: Platform.OS === 'android' ? 60 : 0

  },
  fab: {
    position: 'absolute',
    bottom: 65,
    right: 10,
    // backgroundColor: config.colors.primary,
    width: 60,
    height: 60,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    // backgroundColor:'white'
    // elevation: 4,
  },
  skeletonPost: {
    height: 250,
    margin: 10,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
  },
  latoText: {
    fontFamily: 'Lato-Regular',
  },
  latoBold: {
    fontFamily: 'Lato-Bold',
  },
  header: {
    paddingTop: 10,
    paddingBottom: 10,
    // backgroundColor: '#fff',
    // alignItems: 'center',
    // justifyContent: 'center',
    borderBottomWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 20
  },
  headerDark: {
    // backgroundColor: '#1e1e1e',
    borderColor: '#333',
  },
  headerText: {
    fontSize: 22,
    fontFamily: 'Lato-Bold',
    color: '#111',
  },
  headerTextDark: {
    color: '#fff',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  menuText: {
    fontSize: 14,
    color: '#333',
    fontFamily: 'Lato-Regular',
  },

  selectedText: {
    color: config.colors.primary,
    fontFamily: 'Lato-Bold',
  },

  menuDivider: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderColor: '#ccc',
  },

  menuLabel: {
    fontWeight: 'bold',
    fontSize: 12,
    color: '#444',
    fontFamily: 'Lato-Bold',
  },


});

export default DesignFeedScreen;
