// ServerScreen.js
import React, { useState, useEffect, useMemo } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    Modal, TextInput, Alert, Linking, Image,
    ActivityIndicator
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {
    ref, push, onValue, query,
    orderByChild, startAt, equalTo, remove,
    set
} from '@react-native-firebase/database';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useLocalState } from '../LocalGlobelStats';
import BannerAdComponent from '../Ads/bannerAds';
import InterstitialAdManager from '../Ads/IntAd';
import { mixpanel } from '../AppHelper/MixPenel';


const ServerScreen = () => {
    const { user, appdatabase, theme } = useGlobalState();
    const [userServers, setUserServers] = useState([]);
    const [adminServer, setAdminServer] = useState([]);
    const [link, setLink] = useState('');
    const [message, setMessage] = useState('');
    const [modalVisible, setModalVisible] = useState(false);
    const [expiryHours, setExpiryHours] = useState('');
    const [loading, setLoading] = useState(true);
    const { localState } = useLocalState()
    // console.log('render')


    const getRemainingTime = (timestamp) => {
        const diff = timestamp - Date.now();
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);
        return hrs >= 1 ? `${hrs} hr${hrs > 1 ? 's' : ''}` : `${mins} min${mins !== 1 ? 's' : ''}`;
    };
    const isDarkMode = theme === 'dark' ? true : false
    useEffect(() => {
        setLoading(true);
        const userServerQuery = query(
            ref(appdatabase, 'users_server'),
            orderByChild('expiresAt'),
            startAt(Date.now())
        );

        const adminServerQuery = ref(appdatabase, 'server');


        const userUnsubscribe = onValue(userServerQuery, (snapshot) => {
            const data = snapshot.val() || {};
            const userList = Object.entries(data)
                .map(([id, value]) => ({ id, ...value }));
            setUserServers(userList);
            setLoading(false);

        });

        const adminUnsubscribe = onValue(adminServerQuery, (snapshot) => {
            const data = snapshot.val() || {};
            const adminList = Object.entries(data).map(([id, value]) => ({ id, ...value }));
            setAdminServer(adminList);
        });

        return () => {
            userUnsubscribe();
            adminUnsubscribe();
        };
    }, []);

    const handleSubmit = () => {
        if (!user?.id) {
            showErrorMessage('Login required', 'Login required to submit a server link');
            return;
        }

        if (!link.trim()) {
            showErrorMessage('Error', 'Link is required');
            return;
        }

        if (!message.trim()) {
            showErrorMessage('Error', 'Message is required');
            return;
        }

        const shouldValidate = adminServer.some(server => server.validate === "true");
        if (shouldValidate && !link.startsWith('https://www.roblox.com/')) {
            showErrorMessage('Error', 'Your link must start with https://www.roblox.com/');
            return;
        }
        const urlRegex = /^(https?:\/\/)([\w-]+\.)+[\w-]{2,}(\/[\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/i;

        if (!urlRegex.test(link)) {
          showErrorMessage('Error', 'There must be a valid link');
          return;
        }
        
        const characterCount = message.trim().length;
        if (characterCount > 250) {
            showWarningMessage('Warning', 'Description can only be 250 characters max.');
            return;
        }

        const parsedHours = parseInt(expiryHours);
        if (parsedHours > 24) {
            showErrorMessage('Error', 'Maximum expiry time is 24 hours.');
            return;
        }

        const hours = isNaN(parsedHours) ? 24 : Math.max(1, parsedHours);
        const expiresAt = Date.now() + hours * 60 * 60 * 1000;

        const callbackfunction = () => {
            showSuccessMessage('Success', '✅ Submitted for review');
            setLink('');
            setMessage('');
            setExpiryHours('');
            setModalVisible(false);
        };

        push(ref(appdatabase, 'users_server'), {
            username: user?.displayName || 'Anonymous',
            userId: user?.id,
            userPhoto: user?.avatar || '',
            link,
            message,
            rating: 0,
            upvotes: 0,
            downvotes: 0,
            expiresAt,
            voters: { [user?.id]: true }
        })
            .then(() => {
                // 👇 Show ad with callback
                if (!localState.isPro && InterstitialAdManager) {
                    InterstitialAdManager.showAd(callbackfunction);
                } else {
                    callbackfunction();
                }
            })
            .catch((error) => {
                showErrorMessage('Error', '❌ Submission failed');
                console.error('Error submitting trade:', error);
            });
    };



    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

    const handleVote = (serverId, type) => {
        if (!user?.id) {
            showWarningMessage('Warning', 'Login required to vote');
            return;
        } else {
            const votePath = type === 'like' ? 'likes' : 'dislikes';
            const oppositePath = type === 'like' ? 'dislikes' : 'likes';

            const voteRef = ref(appdatabase, `users_server/${serverId}/${votePath}/${user.id}`);
            const oppositeRef = ref(appdatabase, `users_server/${serverId}/${oppositePath}/${user.id}`);

            remove(oppositeRef).then(() => set(voteRef, true)).catch(console.error);
        }
    };
    const handleLinkPress = (url) => {
        // console.log(url)
        const trimmedUrl = url?.trim();
        const openLink = () => {
          Linking.openURL(trimmedUrl).catch(err => {
            console.warn('Failed to open link:', err);
            showErrorMessage('Error', 'Failed to open link');
          });
        };
      
        if (!localState.isPro) {
          InterstitialAdManager.showAd(openLink);
        } else {
          openLink();
          mixpanel.track("Server Open");
        }
      };
      

    const handleDelete = (serverId) => {
        Alert.alert('Delete', 'Are you sure you want to delete this?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                onPress: () => {
                    remove(ref(appdatabase, `users_server/${serverId}`));
                    showSuccessMessage('Success', 'Deleted successfully');
                }
            }
        ]);
    };

    const renderItem = ({ item }) => {
        const userLiked = item.likes && item.likes[user.id];
        const userDisliked = item.dislikes && item.dislikes[user.id];
        const likeCount = item.likes ? Object.keys(item.likes).length : 0;
        const dislikeCount = item.dislikes ? Object.keys(item.dislikes).length : 0;

        return (
            <View style={styles.card}>

                <View style={styles.topRow}>
                    <View style={styles.userInfo}>
                        <Image source={{ uri: item.userPhoto }} style={styles.avatar} />
                        <Text style={styles.username}>{item.username}</Text>
                    </View>

                    {item.userId === user?.id && (
                        <TouchableOpacity onPress={() => handleDelete(item.id)}>
                            <FontAwesome
                                name={'trash-can'}
                                size={16}
                                color={'red'}
                                solid={true}
                            />
                            {/* <Icon name="trash" size={18} color="red" /> */}
                        </TouchableOpacity>
                    )}
                </View>

                <TouchableOpacity onPress={() => handleLinkPress(item.link)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <Text style={{ fontSize: 14, marginRight: 4 }}>🔗</Text>
                    <Text style={styles.linkText}>{item.link}</Text>
                </TouchableOpacity>

                {item.message ? <Text style={styles.message}>💬 {item.message}</Text> : null}
                {item.expiresAt && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 12, color: 'tomato', marginTop: 4 }}>
                            ⏰ Expires in: {getRemainingTime(item.expiresAt)}
                        </Text>
                        <View style={styles.voteRow}>
                            <TouchableOpacity onPress={() => handleVote(item.id, 'like')}>
                                <FontAwesome name="thumbs-up" size={18} color={userLiked ? config.colors.primary : '#aaa'} solid={true} />
                            </TouchableOpacity>
                            <Text style={styles.voteText}>{likeCount}</Text>
                            <TouchableOpacity onPress={() => handleVote(item.id, 'dislike')} style={{ marginLeft: 12 }}>
                                <FontAwesome name="thumbs-down" size={18} color={userDisliked ? 'tomato' : '#aaa'} solid={true} />
                            </TouchableOpacity>
                            <Text style={styles.voteText}>{dislikeCount}</Text>
                        </View>
                    </View>
                )}

            </View>
        );
    }


    return (
        <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 12 }}>
            {loading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color={config.colors.primary} />
                </View>) : (<>
                    <View style={styles.adminGrid}>
                        {Array.from({ length: Math.ceil(adminServer.length / 2) }, (_, rowIndex) => {
                            const rowItems = adminServer.slice(rowIndex * 2, rowIndex * 2 + 2);
                            return (
                                <View key={rowIndex} style={styles.adminRow} >
                                    {rowItems.map((item) => (
                                        <TouchableOpacity key={item.id} style={styles.admincard} onPress={() => handleLinkPress(item.link)}>
                                            <Text style={styles.title}>{item.name}</Text>
                                            <Text style={styles.text}>{item.text}</Text>
                                        </TouchableOpacity>
                                    ))}
                                    {/* {rowItems.length === 1 && <View style={[styles.admincard]} />} */}
                                </View>
                            );
                        })}
                    </View>

                    <Text style={styles.header}>Community Submissions</Text>
                    <FlatList
                        data={userServers}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        contentContainerStyle={{ paddingBottom: 120 }}
                        showsVerticalScrollIndicator={false}
                    />

                    <TouchableOpacity onPress={() => {
                        if (!user?.id) {
                            showWarningMessage('Warning', 'Login required to post a server link');
                        } else {
                            setModalVisible(true);
                        }
                    }} style={styles.fab}>
                        <FontAwesome name="circle-plus" size={44} solid={true} color={config.colors.primary} />
                        {/* <Icon name="plus" size={24} color="#fff" /> */}
                    </TouchableOpacity></>
            )}
            {!localState.isPro && <BannerAdComponent />}


            <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalContainer}>
                        <TouchableOpacity onPress={() => setModalVisible(false)} style={{ position: 'absolute', top: 10, right: 10 }}>
                            <Icon name="close" size={22} color="#555" />
                        </TouchableOpacity>
                        <Text style={styles.modalHeader}>Submit Your Server or Help Link</Text>
                        <TextInput style={styles.input} placeholder="Server link or help link" value={link} onChangeText={setLink} placeholderTextColor={'lightgrey'} />
                        <TextInput
                            style={[styles.input, { height: 100 }]} // you can adjust height as needed
                            placeholder="Optional message"
                            value={message}
                            onChangeText={setMessage}
                            placeholderTextColor={'lightgrey'}
                            multiline={true}
                            numberOfLines={4}
                        />

                        <TextInput
                            style={styles.input}
                            placeholder="Expiry in hours (default 24)"
                            placeholderTextColor={'lightgrey'}
                            value={expiryHours}
                            onChangeText={setExpiryHours}
                            keyboardType="numeric"
                        />
                        <TouchableOpacity onPress={handleSubmit} style={styles.submitButton}>
                            <Text style={styles.submitText}>Submit</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
};


const getStyles = (isDarkMode) =>
    StyleSheet.create({
        header: {
            fontSize: 18,
            fontFamily: 'Lato-Bold',
            marginVertical: 12,
            color: isDarkMode ? 'white' : 'black',

        },
        adminGrid: {
            marginBottom: 12,
        },
        adminRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 12,
        },
        admincard: {
            padding: 10,
            backgroundColor: '#FFD700',
            borderRadius: 12,
            width: '48%',
            alignItems: 'center',
            textAlign: 'center'
        },
        card: {
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            marginBottom: 10,
            backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', // Da
        },
        title: {
            fontSize: 16,
            fontFamily: 'Lato-Bold',
            color: isDarkMode ? 'black' : 'black',

        },
        linkText: {
            fontSize: 14,
            color: '#007bff',
            color: isDarkMode ? 'lightblue' : '#007bff',
            textDecorationLine: 'underline',
            fontFamily: 'Lato-Regular',
        },
        message: {
            fontSize: 13,
            color: '#333',
            marginTop: 4,
            fontFamily: 'Lato-Regular',
            color: isDarkMode ? 'white' : 'black',

        },
        voteRow: {
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 4,
        },
        voteText: {
            paddingHorizontal: 4,
            fontFamily: 'Lato-Regular',
            color: isDarkMode ? 'white' : 'black',

        },
        fab: {
            position: 'absolute',
            bottom: 60,
            right: 12,
            width: 56,
            height: 56,
            borderRadius: 28,
            justifyContent: 'center',
            alignItems: 'center',
        },
        modalBackdrop: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            justifyContent: 'center',
            alignItems: 'center',
        },
        modalContainer: {
            backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
            padding: 20,
            width: '90%',
            borderRadius: 12,
            elevation: 10,
            position: 'relative',
        },
        modalHeader: {
            fontSize: 18,
            fontFamily: 'Lato-Bold',
            marginBottom: 12,
            color: isDarkMode ? 'white' : 'black',
        },
        input: {
            borderWidth: 1,
            borderColor: '#ddd',
            padding: 10,
            marginBottom: 12,
            borderRadius: 8,
            fontFamily: 'Lato-Regular',
            color: isDarkMode ? 'white' : 'black',

        },
        submitButton: {
            backgroundColor: config.colors.primary,
            padding: 12,
            borderRadius: 8,
            alignItems: 'center',
        },
        submitText: {
            color: '#fff',
            fontFamily: 'Lato-Bold',
            //   color: isDarkMode ? 'white' : 'black',

        },
        topRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        userInfo: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        avatar: {
            width: 28,
            height: 28,
            borderRadius: 14,
            marginRight: 8,
        },
        username: {
            fontFamily: 'Lato-Bold',
            color: isDarkMode ? 'white' : 'black',

        },
        text: {
            fontSize: 9,
            //   alignSelf: 'center',
            margin: 'auto',
            fontFamily: 'Lato-Regular',
            color: isDarkMode ? 'black' : 'black',
            textAlign: 'center',
            paddingTop: 3

        }
    });


export default ServerScreen;