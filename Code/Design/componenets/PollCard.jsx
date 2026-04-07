import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TextInput,
    Image,
    ActivityIndicator,
    Animated,
    StyleSheet,
    Keyboard,
    Alert,
    LayoutAnimation,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
    collection,
    doc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    orderBy,
    limit,
    startAfter,
    Timestamp,
} from '@react-native-firebase/firestore';

dayjs.extend(relativeTime);

const DEFAULT_AVATAR = 'https://ui-avatars.com/api/?background=007AFF&color=fff&name=U';
const COMMENTS_PAGE_SIZE = 2;

const PollCard = ({ poll, user, firestoreDB, isDarkMode, onRequireSignIn }) => {
    const navigation = useNavigation();
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [voted, setVoted] = useState(false);
    const [selectedOption, setSelectedOption] = useState(null);
    const [options, setOptions] = useState(poll?.options || []);
    const [totalVotes, setTotalVotes] = useState(poll?.totalVotes || 0);
    const [voting, setVoting] = useState(false);

    // Comments (paginated)
    const [showComments, setShowComments] = useState(false);
    const [comments, setComments] = useState([]);
    const [loadingComments, setLoadingComments] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [replyingTo, setReplyingTo] = useState(null);
    const [posting, setPosting] = useState(false);
    const [lastCommentDoc, setLastCommentDoc] = useState(null);
    const [hasMoreComments, setHasMoreComments] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    // Animated bars
    const barAnims = useRef(options.map(() => new Animated.Value(0))).current;

    // Check if user already voted (but keep collapsed)
    useEffect(() => {
        if (poll?.voters && user?.id) {
            const prev = poll.voters[user.id];
            if (prev !== undefined && prev !== null) {
                setVoted(true);
                setSelectedOption(prev);
                // Don't auto-expand — polls always start collapsed
            }
        }
    }, [poll, user]);

    const animateBars = useCallback((opts, total) => {
        if (!total) return;
        const anims = opts.map((opt, i) => {
            const pct = opt.votes / total;
            return Animated.timing(barAnims[i], {
                toValue: pct,
                duration: 600,
                useNativeDriver: false,
            });
        });
        Animated.stagger(80, anims).start();
    }, [barAnims]);

    const toggleExpand = useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        const willExpand = !expanded;
        setExpanded(willExpand);
        // Animate bars when expanding if already voted
        if (willExpand && voted) {
            setTimeout(() => animateBars(options, totalVotes), 100);
        }
    }, [expanded, voted, options, totalVotes, animateBars]);

    // ─────────── Vote (supports changing vote) ───────────
    const handleVote = useCallback(async (index) => {
        if (voting) return;
        // If user is not signed in, trigger sign-in flow
        if (!user?.id) {
            if (onRequireSignIn) onRequireSignIn();
            return;
        }
        if (!poll?.id) return;
        // If already voted for the same option, do nothing
        if (voted && selectedOption === index) return;

        setVoting(true);
        try {
            const pollRef = doc(firestoreDB, 'polls', poll.id);
            const newOptions = [...options];
            let newTotal = totalVotes;

            if (voted && selectedOption !== null && selectedOption !== undefined) {
                // Changing vote: decrement old, increment new
                newOptions[selectedOption] = {
                    ...newOptions[selectedOption],
                    votes: Math.max((newOptions[selectedOption].votes || 0) - 1, 0),
                };
                newOptions[index] = {
                    ...newOptions[index],
                    votes: (newOptions[index].votes || 0) + 1,
                };
                // totalVotes stays the same
            } else {
                // First vote
                newOptions[index] = {
                    ...newOptions[index],
                    votes: (newOptions[index].votes || 0) + 1,
                };
                newTotal = totalVotes + 1;
            }

            await updateDoc(pollRef, {
                options: newOptions,
                totalVotes: newTotal,
                [`voters.${user.id}`]: index,
            });

            setOptions(newOptions);
            setTotalVotes(newTotal);
            setSelectedOption(index);
            setVoted(true);

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            animateBars(newOptions, newTotal);
        } catch (err) {
            console.error('Vote error:', err);
            Alert.alert(t('poll.error'), t('poll.vote_error'));
        } finally {
            setVoting(false);
        }
    }, [voted, voting, user, poll, options, totalVotes, selectedOption, firestoreDB, animateBars, onRequireSignIn]);

    // ─────────── Comments (paginated: 2 at a time) ───────────
    const fetchComments = useCallback(async (afterDoc = null) => {
        if (!poll?.id) return;
        if (afterDoc) {
            setLoadingMore(true);
        } else {
            setLoadingComments(true);
        }
        try {
            const commentsRef = collection(firestoreDB, 'polls', poll.id, 'comments');
            let q;
            if (afterDoc) {
                q = query(commentsRef, orderBy('createdAt', 'asc'), startAfter(afterDoc), limit(COMMENTS_PAGE_SIZE));
            } else {
                q = query(commentsRef, orderBy('createdAt', 'asc'), limit(COMMENTS_PAGE_SIZE));
            }
            const snapshot = await getDocs(q);
            const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

            if (afterDoc) {
                setComments((prev) => [...prev, ...list]);
            } else {
                setComments(list);
            }

            if (snapshot.docs.length > 0) {
                setLastCommentDoc(snapshot.docs[snapshot.docs.length - 1]);
            }
            setHasMoreComments(snapshot.docs.length === COMMENTS_PAGE_SIZE);
        } catch (err) {
            console.error('Fetch comments error:', err);
        } finally {
            setLoadingComments(false);
            setLoadingMore(false);
        }
    }, [poll, firestoreDB]);

    const toggleComments = useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        if (!showComments && comments.length === 0) {
            fetchComments();
        }
        setShowComments(!showComments);
    }, [showComments, comments, fetchComments]);

    const postComment = useCallback(async () => {
        const text = commentText.trim();
        if (!text || posting) return;
        // If user is not signed in, trigger sign-in flow
        if (!user?.id) {
            if (onRequireSignIn) onRequireSignIn();
            return;
        }
        if (!poll?.id) return;

        setPosting(true);
        Keyboard.dismiss();
        try {
            const commentsRef = collection(firestoreDB, 'polls', poll.id, 'comments');
            const newComment = {
                userId: user.id,
                userName: user.displayName || user.userName || 'User',
                userAvatar: user.avatar || DEFAULT_AVATAR,
                text,
                createdAt: Timestamp.now(),
                replyTo: replyingTo?.id || null,
            };
            const docRef = await addDoc(commentsRef, newComment);
            setComments((prev) => [...prev, { id: docRef.id, ...newComment }]);
            setCommentText('');
            setReplyingTo(null);
        } catch (err) {
            console.error('Post comment error:', err);
            Alert.alert(t('poll.error'), t('poll.comment_error'));
        } finally {
            setPosting(false);
        }
    }, [commentText, user, poll, firestoreDB, replyingTo, posting, onRequireSignIn]);

    // ─────────── Chat with commenter ───────────
    const handleChatWithUser = useCallback((comment) => {
        if (!user?.id) return;
        if (comment.userId === user.id) return; // can't chat with self
        navigation.navigate('PrivateChat', {
            selectedUser: {
                senderId: comment.userId,
                sender: comment.userName,
                avatar: comment.userAvatar || DEFAULT_AVATAR,
            },
        });
    }, [user, navigation]);

    // ─────────── Threaded comments ───────────
    const threadedComments = useMemo(() => {
        const topLevel = comments.filter((c) => !c.replyTo);
        const replies = comments.filter((c) => c.replyTo);
        const replyMap = {};
        replies.forEach((r) => {
            if (!replyMap[r.replyTo]) replyMap[r.replyTo] = [];
            replyMap[r.replyTo].push(r);
        });
        return topLevel.map((c) => ({
            ...c,
            replies: replyMap[c.id] || [],
        }));
    }, [comments]);

    // ─────────── Colors ───────────
    const cardBg = isDarkMode ? '#1C1C1E' : '#FFF';
    const cardBorder = isDarkMode ? '#2C2C2E' : '#E5E5EA';
    const textPrimary = isDarkMode ? '#FFF' : '#000';
    const textSecondary = isDarkMode ? '#8E8E93' : '#666';
    const textTertiary = isDarkMode ? '#555' : '#CCC';
    const optionBg = isDarkMode ? '#2C2C2E' : '#F2F2F7';
    const barColor = '#007AFF';
    const selectedBarColor = '#34C759';
    const inputBg = isDarkMode ? '#2C2C2E' : '#F2F2F7';

    const formatTime = (ts) => {
        if (!ts) return '';
        const d = ts?.toDate ? ts.toDate() : new Date(ts);
        return dayjs(d).fromNow();
    };

    const renderComment = (comment, isReply = false) => (
        <View
            key={comment.id}
            style={[
                styles.commentRow,
                isReply && { marginLeft: 36, borderLeftWidth: 2, borderLeftColor: isDarkMode ? '#333' : '#E5E5EA', paddingLeft: 10 },
            ]}
        >
            <TouchableOpacity onPress={() => handleChatWithUser(comment)}>
                <Image
                    source={{ uri: comment.userAvatar || DEFAULT_AVATAR }}
                    style={styles.commentAvatar}
                />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => handleChatWithUser(comment)}>
                        <Text style={[styles.commentUserName, { color: textPrimary }]}>{comment.userName}</Text>
                    </TouchableOpacity>
                    <Text style={[styles.commentTime, { color: textTertiary }]}>{formatTime(comment.createdAt)}</Text>
                </View>
                <Text style={[styles.commentText, { color: textPrimary }]}>{comment.text}</Text>
                {!isReply && (
                    <TouchableOpacity
                        onPress={() => setReplyingTo({ id: comment.id, userName: comment.userName })}
                        style={styles.replyBtn}
                    >
                        <Icon name="return-down-forward-outline" size={13} color={textSecondary} />
                        <Text style={[styles.replyBtnText, { color: textSecondary }]}>{t('poll.reply')}</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );

    if (!poll) return null;

    // ─────────── Collapsed (compact) view ───────────
    if (!expanded) {
        return (
            <TouchableOpacity
                onPress={toggleExpand}
                activeOpacity={0.8}
                style={[styles.compactCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <View style={styles.pollBadgeSmall}>
                        <Icon name="bar-chart" size={12} color="#FFF" />
                    </View>
                    <Text style={[styles.compactQuestion, { color: textPrimary }]} numberOfLines={1}>
                        {poll.question}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' }}>
                        <Text style={{ color: textSecondary, fontSize: 11, marginRight: 6 }}>{t('poll.votes', { count: totalVotes })}</Text>
                        <Icon name="chevron-down" size={16} color={textSecondary} />
                    </View>
                </View>
            </TouchableOpacity>
        );
    }

    // ─────────── Expanded (full) view ───────────
    return (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.pollBadge}>
                    <Icon name="bar-chart" size={14} color="#FFF" />
                    <Text style={styles.pollBadgeText}>{t('poll.badge')}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.timeText, { color: textSecondary, marginRight: 8 }]}>{formatTime(poll.createdAt)}</Text>
                    <TouchableOpacity onPress={toggleExpand} style={{ padding: 4 }}>
                        <Icon name="chevron-up" size={18} color={textSecondary} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Image */}
            {poll.imageUrl ? (
                <Image
                    source={{ uri: poll.imageUrl }}
                    style={styles.pollImage}
                    resizeMode="cover"
                />
            ) : null}

            {/* Question */}
            <Text style={[styles.question, { color: textPrimary }]}>{poll.question}</Text>

            {/* Options */}
            <View style={styles.optionsContainer}>
                {options.map((opt, index) => {
                    const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                    const isSelected = selectedOption === index;

                    return (
                        <TouchableOpacity
                            key={index}
                            activeOpacity={0.7}
                            onPress={() => handleVote(index)}
                            style={[
                                styles.optionRow,
                                { backgroundColor: optionBg, borderColor: isSelected ? barColor : 'transparent' },
                                isSelected && { borderWidth: 1.5 },
                            ]}
                            disabled={voting}
                        >
                            {voted && (
                                <Animated.View
                                    style={[
                                        styles.optionBar,
                                        {
                                            backgroundColor: isSelected ? selectedBarColor + '30' : barColor + '18',
                                            width: barAnims[index]
                                                ? barAnims[index].interpolate({
                                                    inputRange: [0, 1],
                                                    outputRange: ['0%', '100%'],
                                                })
                                                : '0%',
                                        },
                                    ]}
                                />
                            )}
                            <View style={styles.optionContent}>
                                {!voted ? (
                                    <View style={[styles.radio, { borderColor: textSecondary }]} />
                                ) : (
                                    <View style={[styles.radioChecked, { backgroundColor: isSelected ? selectedBarColor : textTertiary }]}>
                                        {isSelected && <Icon name="checkmark" size={12} color="#FFF" />}
                                    </View>
                                )}
                                <Text style={[styles.optionText, { color: textPrimary }]} numberOfLines={2}>
                                    {opt.text}
                                </Text>
                                {voted && (
                                    <Text style={[styles.optionPct, { color: isSelected ? selectedBarColor : textSecondary }]}>
                                        {pct}%
                                    </Text>
                                )}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Meta row */}
            <View style={styles.metaRow}>
                {voting ? (
                    <ActivityIndicator size="small" color={barColor} />
                ) : (
                    <Text style={[styles.metaText, { color: textSecondary }]}>
                        {t('poll.votes', { count: totalVotes })}
                    </Text>
                )}
                <TouchableOpacity onPress={toggleComments} style={styles.commentsToggle}>
                    <Icon name={showComments ? 'chatbubble' : 'chatbubble-outline'} size={16} color={textSecondary} />
                    <Text style={[styles.metaText, { color: textSecondary, marginLeft: 4 }]}>
                        {comments.length > 0 ? t('poll.comments', { count: comments.length }) : t('poll.comments_zero')}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Comments Section */}
            {showComments && (
                <View style={[styles.commentsSection, { borderTopColor: cardBorder }]}>
                    {loadingComments ? (
                        <ActivityIndicator size="small" color={barColor} style={{ paddingVertical: 16 }} />
                    ) : (
                        <>
                            {threadedComments.length === 0 && (
                                <Text style={[styles.noComments, { color: textTertiary }]}>
                                    {t('poll.no_comments')}
                                </Text>
                            )}
                            {threadedComments.map((c) => (
                                <View key={c.id}>
                                    {renderComment(c)}
                                    {c.replies.map((r) => renderComment(r, true))}
                                </View>
                            ))}

                            {/* Load more button */}
                            {hasMoreComments && (
                                <TouchableOpacity
                                    onPress={() => fetchComments(lastCommentDoc)}
                                    disabled={loadingMore}
                                    style={styles.loadMoreBtn}
                                >
                                    {loadingMore ? (
                                        <ActivityIndicator size="small" color={barColor} />
                                    ) : (
                                        <Text style={[styles.loadMoreText, { color: barColor }]}>{t('poll.load_more_comments')}</Text>
                                    )}
                                </TouchableOpacity>
                            )}
                        </>
                    )}

                    {replyingTo && (
                        <View style={[styles.replyIndicator, { backgroundColor: inputBg }]}>
                            <Text style={{ color: textSecondary, fontSize: 12, flex: 1 }}>
                                {t('poll.replying_to')} <Text style={{ fontWeight: '600', color: textPrimary }}>{replyingTo.userName}</Text>
                            </Text>
                            <TouchableOpacity onPress={() => setReplyingTo(null)} style={{ padding: 4 }}>
                                <Icon name="close" size={16} color={textSecondary} />
                            </TouchableOpacity>
                        </View>
                    )}

                    {user?.id && (
                        <View style={[styles.commentInputRow, { backgroundColor: inputBg }]}>
                            <TextInput
                                value={commentText}
                                onChangeText={setCommentText}
                                placeholder={replyingTo ? t('poll.reply_placeholder', { name: replyingTo.userName }) : t('poll.comment_placeholder')}
                                placeholderTextColor={textTertiary}
                                style={[styles.commentInput, { color: textPrimary }]}
                                multiline
                                maxLength={300}
                                returnKeyType="send"
                                blurOnSubmit
                                onSubmitEditing={postComment}
                            />
                            <TouchableOpacity
                                onPress={postComment}
                                disabled={posting || !commentText.trim()}
                                style={[styles.sendBtn, { opacity: commentText.trim() ? 1 : 0.4 }]}
                            >
                                {posting ? (
                                    <ActivityIndicator size="small" color="#FFF" />
                                ) : (
                                    <Icon name="send" size={16} color="#FFF" />
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    compactCard: {
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 8,
    },
    pollBadgeSmall: {
        backgroundColor: '#5856D6',
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    compactQuestion: {
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
        marginRight: 8,
    },
    card: {
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 10,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingTop: 12,
    },
    pollBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#5856D6',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
    },
    pollBadgeText: {
        color: '#FFF',
        fontSize: 11,
        fontWeight: '700',
        marginLeft: 4,
        letterSpacing: 0.5,
    },
    timeText: { fontSize: 12 },
    pollImage: {
        width: '100%',
        height: 160,
        marginTop: 10,
    },
    question: {
        fontSize: 16,
        fontWeight: '700',
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 6,
        lineHeight: 22,
    },
    optionsContainer: {
        paddingHorizontal: 14,
        paddingBottom: 6,
    },
    optionRow: {
        borderRadius: 10,
        marginBottom: 6,
        overflow: 'hidden',
        position: 'relative',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    optionBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        borderRadius: 10,
    },
    optionContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 11,
        zIndex: 1,
    },
    radio: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        marginRight: 10,
    },
    radioChecked: {
        width: 18,
        height: 18,
        borderRadius: 9,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionText: {
        fontSize: 14,
        flex: 1,
        fontWeight: '500',
    },
    optionPct: {
        fontSize: 13,
        fontWeight: '700',
        marginLeft: 8,
        minWidth: 34,
        textAlign: 'right',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingBottom: 10,
    },
    metaText: { fontSize: 13 },
    commentsToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 4,
    },
    commentsSection: {
        borderTopWidth: 1,
        paddingTop: 10,
        paddingHorizontal: 14,
        paddingBottom: 10,
    },
    noComments: {
        textAlign: 'center',
        paddingVertical: 10,
        fontSize: 13,
    },
    commentRow: {
        flexDirection: 'row',
        marginBottom: 10,
    },
    commentAvatar: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: '#DDD',
    },
    commentUserName: {
        fontSize: 12,
        fontWeight: '600',
    },
    commentTime: {
        fontSize: 10,
        marginLeft: 6,
    },
    commentText: {
        fontSize: 13,
        marginTop: 2,
        lineHeight: 18,
    },
    replyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 3,
        paddingVertical: 2,
    },
    replyBtnText: {
        fontSize: 11,
        fontWeight: '500',
        marginLeft: 4,
    },
    replyIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
        marginBottom: 6,
    },
    commentInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 5,
        minHeight: 38,
    },
    commentInput: {
        flex: 1,
        fontSize: 13,
        maxHeight: 70,
        paddingVertical: 3,
    },
    sendBtn: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: '#007AFF',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    loadMoreBtn: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    loadMoreText: {
        fontSize: 13,
        fontWeight: '600',
    },
});

export default React.memo(PollCard);
