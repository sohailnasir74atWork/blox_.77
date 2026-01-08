// NewsScreen.jsx
import React, {
    useState,
    useCallback,
    useMemo,
    useEffect,
} from "react";
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Alert,
    TextInput,
    RefreshControl,
} from "react-native";
import { useGlobalState } from "../GlobelStats";
import { useLocalState } from "../LocalGlobelStats";
import { ref, push, get } from "@react-native-firebase/database";
import { useFocusEffect } from "@react-navigation/native";
import config from "../Helper/Environment";
import ConditionalKeyboardWrapper from "../Helper/keyboardAvoidingContainer";

const NewsScreen = () => {
    const { appdatabase, theme, user } = useGlobalState(); // assumes 'light' | 'dark'
    const { localState, updateLocalState } = useLocalState();
    const isDark = theme === "dark";

    // simple theme palette
    const palette = useMemo(
        () =>
            isDark
                ? {
                    // 🔳 Very dark background
                    background: "#000000",          // true black

                    // 🧱 Surfaces clearly separated from bg
                    card: "#10151A",                // much lighter than bg
                    subtleCard: "#0B1014",

                    // 🧵 Stronger borders for separation
                    border: "rgba(255,255,255,0.22)",

                    // ✍️ Text with real contrast
                    textPrimary: "#FFFFFF",         // pure white
                    textSecondary: "#D5E2DC",       // very light, still with a soft tint

                    // 🌱 Chips / inputs slightly lifted from bg
                    chipBg: "#141C20",
                    inputBg: "#0B1014",
                    inputBorder: "rgba(255,255,255,0.35)", // clear, visible outline
                }
                : {
                    background: "#f3f7f5",
                    card: "#ffffff",
                    subtleCard: "#edf5f1",
                    border: "rgba(0,0,0,0.06)",
                    textPrimary: "#0b1510",
                    textSecondary: "#4c6357",
                    chipBg: "#edf5f1",
                    inputBg: "#ffffff",
                    inputBorder: "rgba(0,0,0,0.08)",
                },
        [isDark],
    );



    // data from backend
    const [newsItems, setNewsItems] = useState([]);
    const [polls, setPolls] = useState([]);
    const [quickSuggestions, setQuickSuggestions] = useState([]);

    const [newsExists, setNewsExists] = useState(false);
    const [loadingNews, setLoadingNews] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // local UI state
    const [pollAnswers, setPollAnswers] = useState({});
    const [quickSending, setQuickSending] = useState(false);
    const [sendingPollId, setSendingPollId] = useState(null);
    const [customFeedback, setCustomFeedback] = useState("");
    const [sendingCustom, setSendingCustom] = useState(false);

    // ✅ Load existing poll votes from local storage on mount
    useEffect(() => {
        if (localState.pollVotes) {
            setPollAnswers(localState.pollVotes);
        }
    }, [localState.pollVotes]);

    // ✅ OPTIMIZED: Process news data (extracted to reusable function)
    const processNewsData = useCallback((data) => {
        if (!data) {
            setNewsExists(false);
            setNewsItems([]);
            setPolls([]);
            setQuickSuggestions([]);
            return;
        }

        setNewsExists(true);

        // updates
        const updatesRaw = data.updates || {};
        const updatesArr = Object.entries(updatesRaw).map(([id, value]) => ({
            id,
            title: value.title ?? "",
            body: value.body ?? "",
            tag: value.tag ?? "",
            order: value.order ?? 0,
        }));
        updatesArr.sort((a, b) => a.order - b.order);

        // polls
        const pollsRaw = data.polls || {};
        const pollsArr = Object.entries(pollsRaw).map(([id, value]) => {
            const optionsRaw = value.options || {};
            const optionsArr = Object.entries(optionsRaw)
                .map(([optId, optVal]) => ({
                    id: optId,
                    label: optVal.label ?? "",
                    order: optVal.order ?? 0,
                }))
                .sort((a, b) => a.order - b.order);

            return {
                id,
                question: value.question ?? "",
                options: optionsArr,
                order: value.order ?? 0,
            };
        });
        pollsArr.sort((a, b) => a.order - b.order);

        // quick suggestions
        const qsRaw = data.quickSuggestions || {};
        const qsArr = Object.entries(qsRaw)
            .map(([id, value]) => ({
                id,
                text: value.text ?? "",
                order: value.order ?? 0,
            }))
            .sort((a, b) => a.order - b.order);

        setNewsItems(updatesArr);
        setPolls(pollsArr);
        setQuickSuggestions(qsArr);
        
        // ✅ Clean up votes for polls that no longer exist or have invalid options
        setPollAnswers((prevAnswers) => {
            const validAnswers = {};
            const currentPollIds = new Set(pollsArr.map(p => p.id));
            
            // Only keep votes for polls that still exist
            Object.entries(prevAnswers).forEach(([pollId, selectedOption]) => {
                if (!currentPollIds.has(pollId)) {
                    // Poll was deleted, remove vote
                    return;
                }
                
                // ✅ Validate that the selected option still exists in current poll
                const poll = pollsArr.find(p => p.id === pollId);
                if (poll) {
                    const optionExists = poll.options.some(opt => opt.label === selectedOption);
                    if (optionExists) {
                        validAnswers[pollId] = selectedOption;
                    }
                    // If option doesn't exist (poll was updated), remove the vote
                }
            });
            
            // ✅ Update local storage if votes were cleaned up
            if (Object.keys(validAnswers).length !== Object.keys(prevAnswers).length) {
                updateLocalState('pollVotes', validAnswers);
            }
            
            return validAnswers;
        });
    }, [updateLocalState]);

    // ✅ OPTIMIZED: Load news data (one-time fetch instead of real-time listener)
    const loadNews = useCallback(async (showLoading = true) => {
        if (!appdatabase) return;

        if (showLoading) {
            setLoadingNews(true);
        } else {
            setRefreshing(true);
        }

        try {
            const newsRef = ref(appdatabase, "news");
            const snapshot = await get(newsRef);
            const data = snapshot.val();
            
            processNewsData(data);
        } catch (error) {
            console.error("Error loading news:", error);
        } finally {
            setLoadingNews(false);
            setRefreshing(false);
        }
    }, [appdatabase, processNewsData]);

    // ✅ OPTIMIZED: Load news on mount and when screen is focused
    useEffect(() => {
        loadNews(true);
    }, [loadNews]);

    // ✅ OPTIMIZED: Poll for news updates every 5 minutes when screen is focused
    useFocusEffect(
        useCallback(() => {
            // Load immediately when screen is focused
            loadNews(false);

            // Set up polling interval (5 minutes)
            const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
            const intervalId = setInterval(() => {
                loadNews(false);
            }, POLL_INTERVAL);

            return () => {
                clearInterval(intervalId);
            };
        }, [loadNews])
    );

    // send feedback to /news_feedback
    const sendToFirebase = useCallback(
        async (payload) => {
            if (!appdatabase) return;
            try {
                const nodeRef = ref(appdatabase, "news_feedback");
                await push(nodeRef, {
                    ...payload,
                    // 👇 who sent it
                    userId: user?.uid || "anonymous",
                    userName: user?.displayName || user?.username || null,
                    userEmail: user?.email || null,
                    createdAt: Date.now(),
                });
            } catch (e) {
                // console.log("Error sending news feedback:", e);
            }
        },
        [appdatabase, user] // 👈 include user in deps
    );


    const handlePollVote = useCallback(
        async (pollId, optionLabel) => {
            // ✅ Validate poll and option still exist (in case Firebase was updated)
            const poll = polls.find(p => p.id === pollId);
            if (!poll) {
                Alert.alert("Error", "This poll no longer exists.");
                return;
            }
            
            const optionExists = poll.options.some(opt => opt.label === optionLabel);
            if (!optionExists) {
                Alert.alert("Error", "This option is no longer available.");
                return;
            }
            
            // ✅ Check if user has already voted for this poll
            if (pollAnswers[pollId]) {
                Alert.alert(
                    "Already Voted",
                    "You have already voted for this poll. You can only vote once per poll."
                );
                return;
            }

            // ✅ Update local state immediately (optimistic update)
            const newAnswers = {
                ...pollAnswers,
                [pollId]: optionLabel,
            };
            setPollAnswers(newAnswers);
            
            // ✅ Save to local storage to persist across sessions
            updateLocalState('pollVotes', newAnswers);

            if (!appdatabase) {
                Alert.alert("Thanks!", "Your vote has been recorded.");
                return;
            }

            try {
                setSendingPollId(pollId);
                await sendToFirebase({
                    type: "poll_vote",
                    pollId,
                    option: optionLabel,
                });
                Alert.alert("Thanks!", "Your vote has been recorded.");
            } catch (e) {
                // ✅ Revert on error
                setPollAnswers(pollAnswers);
                updateLocalState('pollVotes', pollAnswers);
                Alert.alert("Error", "Could not send your vote right now.");
            } finally {
                setSendingPollId(null);
            }
        },
        [appdatabase, sendToFirebase, pollAnswers, updateLocalState, polls]
    );

    const handleQuickSuggestion = useCallback(
        async (text) => {
            if (!appdatabase) {
                Alert.alert("Thanks!", "Suggestion noted.");
                return;
            }

            try {
                setQuickSending(true);
                await sendToFirebase({
                    type: "quick_suggestion",
                    text,
                });
                Alert.alert("Thanks!", "Your suggestion has been sent.");
            } catch (e) {
                Alert.alert(
                    "Error",
                    "Could not send your suggestion right now. Please try again later."
                );
            } finally {
                setQuickSending(false);
            }
        },
        [appdatabase, sendToFirebase]
    );

    const handleCustomFeedbackSubmit = useCallback(async () => {
        const trimmed = customFeedback.trim();
        if (!trimmed) {
            Alert.alert("Empty", "Please type your idea first.");
            return;
        }

        if (!appdatabase) {
            setCustomFeedback("");
            Alert.alert("Thanks!", "Feedback noted.");
            return;
        }

        try {
            setSendingCustom(true);
            await sendToFirebase({
                type: "custom_feedback",
                text: trimmed,
            });
            setCustomFeedback("");
            Alert.alert("Thanks!", "Your feedback has been sent.");
        } catch (e) {
            Alert.alert(
                "Error",
                "Could not send your feedback right now. Please try again later."
            );
        } finally {
            setSendingCustom(false);
        }
    }, [appdatabase, customFeedback, sendToFirebase]);

    // ⏳ loading state
    if (loadingNews) {
        return (
            <View
                style={[
                    styles.loadingContainer,
                    { backgroundColor: palette.background },
                ]}
            >
                <ActivityIndicator
                    size="small"
                    color={config.colors.hasBlockGreen}
                />
                <Text
                    style={[
                        styles.loadingText,
                        { color: palette.textSecondary },
                    ]}
                >
                    Checking for updates...
                </Text>
            </View>
        );
    }

    // 🚫 no /news node or completely empty
    if (!newsExists) {
        return (
            <View
                style={[
                    styles.loadingContainer,
                    { backgroundColor: palette.background },
                ]}
            >
                <Text
                    style={[
                        styles.sectionTitle,
                        { color: palette.textPrimary, marginBottom: 4 },
                    ]}
                >
                    Nothing new… yet
                </Text>
                <Text
                    style={[
                        styles.sectionSubtitle,
                        { color: palette.textSecondary, textAlign: "center" },
                    ]}
                >
                    Check back later for updates and polls.
                </Text>
            </View>
        );
    }

    // ✅ normal content
    return (
        <ConditionalKeyboardWrapper style={{ flex: 1 }} >

        <ScrollView
            style={[styles.container, { backgroundColor: palette.background }]}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => loadNews(false)}
                    tintColor={config.colors.hasBlockGreen}
                    colors={[config.colors.hasBlockGreen]}
                />
            }
        >
            {/* Updates section */}
            {newsItems.length > 0 && (
                <>
                    <View style={styles.sectionHeaderRow}>
                        <View>
                            <Text
                                style={[
                                    styles.sectionTitle,
                                    { color: palette.textPrimary },
                                ]}
                            >
                                Updates
                            </Text>
                            <Text
                                style={[
                                    styles.sectionSubtitle,
                                    { color: palette.textSecondary },
                                ]}
                            >
                                What’s new in the app right now.
                            </Text>
                        </View>
                    </View>

                    {newsItems.map((item) => (
                        <View
                            key={item.id}
                            style={[
                                styles.newsCard,
                                {
                                    backgroundColor: palette.card,
                                    borderColor: palette.border,
                                },
                            ]}
                        >
                            <View style={styles.newsHeaderRow}>
                                <Text
                                    style={[
                                        styles.newsTitle,
                                        { color: palette.textPrimary },
                                    ]}
                                >
                                    {item.title}
                                </Text>
                                {!!item.tag && (
                                    <View
                                        style={[
                                            styles.tagChip,
                                            { backgroundColor: config.colors.hasBlockGreen },
                                        ]}
                                    >
                                        <Text style={styles.tagText}>{item.tag}</Text>
                                    </View>
                                )}
                            </View>
                            <Text
                                style={[
                                    styles.newsBody,
                                    { color: palette.textSecondary },
                                ]}
                            >
                                {item.body}
                            </Text>
                        </View>
                    ))}

                    <View style={styles.sectionSpacing} />
                </>
            )}

            {/* Polls section */}
            {polls.length > 0 && (
                <>
                    <Text
                        style={[
                            styles.sectionTitle,
                            { color: palette.textPrimary },
                        ]}
                    >
                        What’s next?
                    </Text>
                    <Text
                        style={[
                            styles.sectionSubtitle,
                            { color: palette.textSecondary },
                        ]}
                    >
                        Vote and help decide the roadmap.
                    </Text>

                    {polls.map((poll) => {
                        const selected = pollAnswers[poll.id];
                        const hasVoted = !!selected; // ✅ Check if user has already voted
                        const loading = sendingPollId === poll.id;

                        return (
                            <View
                                key={poll.id}
                                style={[
                                    styles.pollCard,
                                    {
                                        backgroundColor: palette.subtleCard,
                                        borderColor: palette.border,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.pollQuestion,
                                        { color: palette.textPrimary },
                                    ]}
                                >
                                    {poll.question}
                                </Text>
                                {poll.options.map((opt) => {
                                    const isSelected = selected === opt.label;
                                    return (
                                        <TouchableOpacity
                                            key={opt.id}
                                            style={[
                                                styles.pollOption,
                                                {
                                                    backgroundColor: isSelected
                                                        ? config.colors.hasBlockGreen
                                                        : palette.card,
                                                    borderColor: isSelected
                                                        ? config.colors.hasBlockGreen
                                                        : palette.border,
                                                    opacity: hasVoted && !isSelected ? 0.5 : 1, // ✅ Dim non-selected options if voted
                                                },
                                            ]}
                                            activeOpacity={0.7}
                                            onPress={() => handlePollVote(poll.id, opt.label)}
                                            disabled={loading || hasVoted} // ✅ Disable if already voted
                                        >
                                            <Text
                                                style={[
                                                    styles.pollOptionText,
                                                    {
                                                        color: isSelected
                                                            ? "#02120b"
                                                            : palette.textSecondary,
                                                        fontFamily: isSelected
                                                            ? "Lato-Bold"
                                                            : "Lato-Regular",
                                                    },
                                                ]}
                                            >
                                                {opt.label}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                                {loading && (
                                    <View style={styles.pollLoadingRow}>
                                        <ActivityIndicator
                                            size="small"
                                            color={config.colors.hasBlockGreen}
                                        />
                                        <Text
                                            style={[
                                                styles.pollLoadingText,
                                                { color: palette.textSecondary },
                                            ]}
                                        >
                                            Sending vote...
                                        </Text>
                                    </View>
                                )}
                            </View>
                        );
                    })}

                    <View style={styles.sectionSpacing} />
                </>
            )}

            {/* Quick suggestions section */}
            {quickSuggestions.length > 0 && (
                <>
                    <Text
                        style={[
                            styles.sectionTitle,
                            { color: palette.textPrimary },
                        ]}
                    >
                        Quick suggestions
                    </Text>
                    <Text
                        style={[
                            styles.helperText,
                            { color: palette.textSecondary },
                        ]}
                    >
                        Tap one of these if you don’t feel like typing.
                    </Text>

                    <View className="chipsRow" style={styles.chipsRow}>
                        {quickSuggestions.map((s) => (
                            <TouchableOpacity
                                key={s.id}
                                style={[
                                    styles.chip,
                                    {
                                        backgroundColor: palette.chipBg,
                                        borderColor: palette.border,
                                    },
                                ]}
                                activeOpacity={0.7}
                                onPress={() => handleQuickSuggestion(s.text)}
                                disabled={quickSending}
                            >
                                <Text
                                    style={[
                                        styles.chipText,
                                        { color: palette.textSecondary },
                                    ]}
                                >
                                    {s.text}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {quickSending && (
                        <View style={styles.pollLoadingRow}>
                            <ActivityIndicator
                                size="small"
                                color={config.colors.hasBlockGreen}
                            />
                            <Text
                                style={[
                                    styles.pollLoadingText,
                                    { color: palette.textSecondary },
                                ]}
                            >
                                Sending suggestion...
                            </Text>
                        </View>
                    )}

                    <View style={styles.sectionSpacing} />
                </>
            )}

            {/* Question template / free text feedback */}
            <Text
                style={[
                    styles.sectionTitle,
                    { color: palette.textPrimary },
                ]}
            >
                Tell us in your own words
            </Text>
            <Text
                style={[
                    styles.sectionSubtitle,
                    { color: palette.textSecondary },
                ]}
            >
                What should we build next? Which app or feature do you want to see?
            </Text>
         
            <View/>

<View
    style={[
        styles.feedbackCard,
        {
            backgroundColor: palette.card,
            borderColor: palette.border,
        },
    ]}
>
    <Text
        style={[
            styles.feedbackLabel,
            { color: palette.textSecondary },
        ]}
    >
        Your idea
    </Text>
    <TextInput
        style={[
            styles.textInput,
            {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
            },
        ]}
        placeholder="Example: Make a separate trading app, or add a raid planner next..."
        placeholderTextColor={palette.textSecondary + "99"}
        value={customFeedback}
        onChangeText={setCustomFeedback}
        multiline
    />
    <TouchableOpacity
        style={[
            styles.submitButton,
            {
                backgroundColor: config.colors.hasBlockGreen,
                opacity: sendingCustom ? 0.7 : 1,
            },
        ]}
        activeOpacity={0.8}
        onPress={handleCustomFeedbackSubmit}
        disabled={sendingCustom}
    >
        {sendingCustom ? (
            <ActivityIndicator size="small" color="#02120b" />
        ) : (
            <Text style={styles.submitButtonText}>Send feedback</Text>
        )}
    </TouchableOpacity>
</View>

        </ScrollView>
        </ConditionalKeyboardWrapper>

    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    contentContainer: {
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 224,
    },

    loadingContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
    },
    loadingText: {
        marginTop: 8,
        fontSize: 14,
        fontFamily: "Lato-Regular",
    },

    sectionHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 6,
        justifyContent: "space-between",
    },
    sectionTitle: {
        fontSize: 18,
        fontFamily: "Lato-Bold",
        marginBottom: 2,
    },
    sectionSubtitle: {
        fontSize: 13,
        fontFamily: "Lato-Regular",
    },
    sectionSpacing: {
        height: 20,
    },

    newsCard: {
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
    },
    newsHeaderRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 4,
    },
    newsTitle: {
        fontSize: 16,
        fontFamily: "Lato-Bold",
        flex: 1,
        paddingRight: 8,
    },
    newsBody: {
        fontSize: 14,
        fontFamily: "Lato-Regular",
        marginTop: 4,
        lineHeight: 20,
    },
    tagChip: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        alignSelf: "flex-start",
    },
    tagText: {
        color: "#02120b",
        fontSize: 11,
        fontFamily: "Lato-Bold",
    },

    pollCard: {
        borderRadius: 16,
        padding: 12,
        marginTop: 10,
        borderWidth: 1,
    },
    pollQuestion: {
        fontSize: 15,
        fontFamily: "Lato-Bold",
        marginBottom: 8,
    },
    pollOption: {
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginVertical: 4,
        borderWidth: 1,
    },
    pollOptionText: {
        fontSize: 14,
    },
    pollLoadingRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 6,
    },
    pollLoadingText: {
        fontSize: 13,
        fontFamily: "Lato-Regular",
        marginLeft: 6,
    },

    helperText: {
        fontSize: 13,
        fontFamily: "Lato-Regular",
        marginBottom: 6,
    },
    chipsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        marginBottom: 8,
    },
    chip: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginRight: 6,
        marginBottom: 6,
        borderWidth: 1,
    },
    chipText: {
        fontSize: 13,
        fontFamily: "Lato-Regular",
    },

    feedbackCard: {
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
    },
    feedbackLabel: {
        fontSize: 13,
        fontFamily: "Lato-Bold",
        marginBottom: 6,
    },
    textInput: {
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
        fontFamily: "Lato-Regular",
        minHeight: 80,
        textAlignVertical: "top",
        marginBottom: 10,
    },
    submitButton: {
        borderRadius: 999,
        paddingVertical: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    submitButtonText: {
        color: "white",
        fontSize: 14,
        fontFamily: "Lato-Bold",
    },
});

export default NewsScreen;
