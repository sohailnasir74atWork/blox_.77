import React, { useState, useCallback, memo } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, Alert, useColorScheme,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import InterstitialAdManager from '../../Ads/IntAd';
import { mixpanel } from '../../AppHelper/MixPenel';
import { useNavigation } from '@react-navigation/native';
import CommentModal from './CommentsModal';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { showMessage } from 'react-native-flash-message';
import ReportModal from './ReportModal';
import dayjs from 'dayjs';
import { get, getDatabase, ref, set } from '@react-native-firebase/database';

const PostCard = ({ item, userId, onLike, localState, appdatabase, onDelete }) => {
  const navigation = useNavigation();
  const liked = !!item.likes?.[userId];
  const likeCount = item.likes ? Object.keys(item.likes).length : 0;
  const [showComments, setShowComments] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  const { theme, isAdmin } = useGlobalState();
  const isDark = theme === 'dark';
  const getTagColor = (tag) => {
    switch (tag.toLowerCase()) {
      case 'scam alert':
        return '#FF3B30'; // Bright red
      case 'looking for trade':
        return '#34C759'; // Vibrant green
      case 'discussion':
        return '#5AC8FA'; // Sky blue
      case 'real or fake':
        return '#AF52DE'; // Purple
      case 'need help':
        return '#FF9500'; // Orange
      case 'misc.':
        return '#8E8E93'; // Neutral gray
      default:
        return config.colors.primary; // Fallback
    }
  };
  const banUserwithEmail = async (email) => {
    const encodeEmail = (email) => email.replace(/\./g, '(dot)');
  
    try {
      const db = getDatabase();
      const banRef = ref(db, `banned_users_by_email_post/${encodeEmail(email)}`);
      const snap = await get(banRef);
  
      let strikeCount = 1;
      let bannedUntil = Date.now() + 24 * 60 * 60 * 1000; // 1 day
      // let bannedUntil = Date.now() +  1 * 60 * 1000; // 1 day
  
      
  
      if (snap.exists()) {
        const data = snap.val();
        strikeCount = data.strikeCount + 1;
  
        if (strikeCount === 2) bannedUntil = Date.now() + 3 * 24 * 60 * 60 * 1000; // 3 days
        //  if (strikeCount === 2) bannedUntil = Date.now() + 2  * 60 * 1000; // 3 days
        else if (strikeCount >= 3) bannedUntil = "permanent";
      }
  
      await set(banRef, {
        strikeCount,
        bannedUntil,
        reason: `Strike ${strikeCount}`
      });
  
      Alert.alert('User Banned', `Strike ${strikeCount} applied.`);
    } catch (err) {
      console.error('Ban error:', err);
      Alert.alert('Error', 'Could not ban user.');
    }
  };
  
 

  const handleChatNavigation = useCallback(() => {
    const callback = () => {
      if (!userId) {
        showMessage({
          message: 'Please sign in to message',
          type: 'warning',
        });
        return;
      }
      
      mixpanel.track('Design Screen');
      navigation.navigate('PrivateChatDesign', {
        selectedUser: {
          senderId: item.userId,
          sender: item.displayName,
          avatar: item.avatar,
        },
        item,
      });
    };





    if (!localState?.isPro) {
      InterstitialAdManager.showAd(callback);
    } else {
      callback();
    }
  }, [userId, item, navigation, localState?.isPro]);

  const themedStyles = getStyles(isDark);
  // console.log(item.createdAt)
  const formattedTime = item.createdAt ? dayjs(item.createdAt.toDate()).fromNow() : 'Anonymous';



  return (
    <View style={themedStyles.card}>
     <View style={themedStyles.header}>
  <Image source={{ uri: item.avatar }} style={themedStyles.avatar} />
  <View style={{ marginLeft: 10, flex: 1 }}>
    <Text style={themedStyles.name}>{item.displayName}</Text>
    <Text style={themedStyles.time}>
      {formattedTime}
    </Text>
  </View>

  <Menu>
    <MenuTrigger>
      <Icon name="ellipsis-v" size={18} color={isDark ? 'lightgrey' : 'grey'} style={{marginRight:5}}/>
    </MenuTrigger>
    <MenuOptions>
      <View>
  <MenuOption onSelect={() => setShowReportModal(true)} text="Report" style={{marginVertical: 5,}} /></View>
    {/* {console.log(isAdmin)} */}
  {(userId === item.userId || isAdmin) && (
 <MenuOption
 onSelect={() => {
   Alert.alert(
     'Delete Post',
     'Are you sure you want to delete this post?',
     [
       { text: 'Cancel', style: 'cancel' },
       { text: 'Delete', onPress: () => onDelete(item.id), style: 'destructive' },
     ]
   );
 }}
>
 <View style={[ {  borderTopWidth:1 }]}>
   <Text style={[themedStyles.tagText,{marginVertical: 15,}  ]}>Delete</Text>
 </View>
</MenuOption>


  )}
 {isAdmin && <MenuOption onSelect={()=>banUserwithEmail(item.email)}>
  <Text>Ban User</Text>
  
  </MenuOption>}
</MenuOptions>

  </Menu>
</View>


      <Text style={themedStyles.desc}>{item?.desc}</Text>

      {/* {(item.selectedTags?.length > 0 || item.budget) && (
        <View style={themedStyles.metaInfoRow}>
          <View style={themedStyles.tagsRow}>
            {item.selectedTags?.map((tag, idx) => (
              <View key={idx} style={themedStyles.tagBadge}>
                <Text style={themedStyles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
          {item.budget && <Text style={themedStyles.budgetText}>Budget: {item.budget}</Text>}
        </View>
      )} */}

{Array.isArray(item.imageUrl) && item.imageUrl.length > 0 && (
  <View style={themedStyles.imageWrapper}>
    {/* Tags positioned above the image container */}
    <View style={themedStyles.tagOverlayAbove}>
      {item.selectedTags?.map((tag, idx) => (
       <View key={idx} style={[themedStyles.overlayTag, { backgroundColor: getTagColor(tag) }]}>
       <Text style={themedStyles.overlayTagText}>{tag}</Text>
     </View>
     
      ))}
    </View>

    {/* Image block as-is */}
    <View style={themedStyles.shadowWrapper}>
    <View style={themedStyles.imageContainer}>
      {item?.imageUrl.length === 1 ? (
        <TouchableOpacity
          onPress={() =>
            navigation.navigate('ImageViewerScreen', {
              images: item.imageUrl,
              initialIndex: 0,
            })
          }
        >
          <Image source={{ uri: item?.imageUrl[0] }} style={themedStyles.singleImage} />
        </TouchableOpacity>
      ) : (
        <View style={themedStyles.multiImageGrid}>
          {item?.imageUrl.slice(0, 4).map((url, idx) => (
            <TouchableOpacity
              key={idx}
              style={themedStyles.gridImage}
              onPress={() =>
                navigation.navigate('ImageViewerScreen', {
                  images: item?.imageUrl,
                  initialIndex: idx,
                })
              }
            >
              <Image source={{ uri: url }} style={themedStyles.gridImageInner} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
    </View>
    <ReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} />

  </View>
)}

      <View style={themedStyles.actionsRow}>
        <View style={{flexDirection:'row'}}>
        <TouchableOpacity onPress={() => onLike(item)} style={themedStyles.actionBtn}>
          <Icon name={liked ? 'heart' : 'heart-o'} size={20} color={liked ? 'red' : 'gray'} />
          <Text style={themedStyles.likeCount}>{likeCount} likes</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowComments(true)} style={themedStyles.commentssection}>
        <Icon name="comment" size={18} color={config.colors.primary} />
        <Text style={themedStyles.sendText}>
          {item.commentCount ? `${item.commentCount} comments` : '0 Comments'}
        </Text>
      </TouchableOpacity>
      </View>

        <TouchableOpacity onPress={handleChatNavigation} style={themedStyles.sendBtn}>
          <Icon name="paper-plane" size={16} color={config.colors.primary} />
          <Text style={themedStyles.sendText}>Chat</Text>
        </TouchableOpacity>
      </View>

      <CommentModal
        visible={showComments}
        onClose={() => setShowComments(false)}
        postId={item.id}
        appdatabase={appdatabase}
      />

    
    </View>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    card: {
      padding: 10,
      borderBottomWidth: 1,
      borderColor: isDark ? '#444' : '#eee',
      backgroundColor: isDark ? '#121212' : '#fff',
    },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
    avatar: { width: 40, height: 40, borderRadius: 20 },
    name: { fontFamily: 'Lato-Bold', color: isDark ? '#fff' : '#000' },
    time: { fontSize: 10, color: 'gray', fontFamily: 'Lato-Regular' },
    desc: { marginVertical: 5, fontSize: 14, color: isDark ? '#ccc' : '#333', fontFamily: 'Lato-Regular' },

    shadowWrapper: {
      // backgroundColor: '#fff', // needed for shadow contrast
      borderRadius: 8,
      // marginTop: 10,
    
      // iOS Shadow
      // shadowColor: '#000',
      // shadowOffset: { width: 0, height: 2 },
      // shadowOpacity: 0.1,
      // shadowRadius: 8,
    
      // // Android
      // elevation: 5,
    },
    
    imageContainer: {
      borderRadius: 8,
      // overflow: 'hidden', // Move it here if you want to clip images inside
      // shadowColor: '#000',
      // shadowOffset: { width: 0, height: 2 },
      // shadowOpacity: 0.1,
      // shadowRadius: 8,
    
      // Android
      // elevation: 1,
      borderWidth:.5,
      borderColor: isDark ? 'grey' : 'lightgrey'

    },
    
    singleImage: { width: '100%', height: 220, borderRadius: 8 },

    multiImageGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 6,
      width: '100%',
      borderRadius: 6,
    
      // Shadow for iOS
      // shadowColor: '#000',
      // shadowOffset: { width: 4, height: 4 },
      // shadowOpacity: 0.5,
      // shadowRadius: 6,
    
      // Elevation for Android
      // elevation: 3,
      // backgroundColor: '#fff',
    },
    
    gridImage: { width: '49%', height: 120, marginBottom: 2, borderRadius: 6},
    gridImageInner: { width: '100%', height: '100%', borderRadius: 8},

    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
      justifyContent: 'space-between',
    },
    actionBtn: { flexDirection: 'row', alignItems: 'center' },
    likeCount: { marginLeft: 5, fontSize: 14, color: isDark ? '#ccc' : config.colors.primary, fontFamily: 'Lato-Bold' },

    sendBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
    },
    commentssection: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      // backgroundColor: isDark ? '#333' : '#f7e7e4',
      borderRadius: 6,
      // marginTop: 6,
      marginLeft:10
    },
    sendText: {
      marginLeft: 6,
      color: config.colors.primary,
      fontWeight: '600',
      fontFamily: 'Lato-Bold',
    },

    metaInfoRow: {
      marginVertical: 6,
      flexDirection: 'column',
      gap: 4,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    tagBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: isDark ? '#444' : '#f0f0f0',
    },
    tagText: {
      fontSize: 12,
      color: isDark ? '#eee' : '#333',
      textTransform: 'capitalize',
      fontFamily: 'Lato-Regular',
    },
    budgetText: {
      fontSize: 13,
      fontStyle: 'italic',
      color: isDark ? '#aaa' : 'gray',
      marginTop: 4,
      fontFamily: 'Lato-Regular',
    },
    imageWrapper: {
      marginTop: 10,
      position: 'relative',
    },
    
    tagOverlayAbove: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      // marginBottom: 6,
      position:'absolute',
      top:5,
      right:5,
      zIndex:1000
    },
    
    overlayTag: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    overlayTagText: {
      fontSize: 12,
      color: '#fff',
      fontFamily: 'Lato-Bold',
    },
    
    
  });

export default memo(PostCard, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.likes === nextProps.item.likes &&
    prevProps.userId === nextProps.userId &&
    prevProps.localState?.isPro === nextProps.localState?.isPro &&
    prevProps.appdatabase === nextProps.appdatabase
  );
});
