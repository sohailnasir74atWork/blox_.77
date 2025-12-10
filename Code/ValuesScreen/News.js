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
} from "react-native";
import { useGlobalState } from "../GlobelStats";
import { ref, push, onValue } from "@react-native-firebase/database";
import config from "../Helper/Environment";
import ConditionalKeyboardWrapper from "../Helper/keyboardAvoidingContainer";

const NewsScreen = () => {
    const { appdatabase, theme, user } = useGlobalState(); // assumes 'light' | 'dark'
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

    // local UI state
    const [pollAnswers, setPollAnswers] = useState({});
    const [quickSending, setQuickSending] = useState(false);
    const [sendingPollId, setSendingPollId] = useState(null);
    const [customFeedback, setCustomFeedback] = useState("");
    const [sendingCustom, setSendingCustom] = useState(false);

    // 🔁 Load /news from Firebase
    useEffect(() => {
        if (!appdatabase) return;

        setLoadingNews(true);

        const newsRef = ref(appdatabase, "news");
        const unsubscribe = onValue(newsRef, (snapshot) => {
            const data = snapshot.val();

            if (!data) {
                setNewsExists(false);
                setNewsItems([]);
                setPolls([]);
                setQuickSuggestions([]);
                setLoadingNews(false);
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
            setLoadingNews(false);
        });

        return () => unsubscribe();
    }, [appdatabase]);

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
                console.log("Error sending news feedback:", e);
            }
        },
        [appdatabase, user] // 👈 include user in deps
    );


    const handlePollVote = useCallback(
        async (pollId, optionLabel) => {
            setPollAnswers((prev) => ({
                ...prev,
                [pollId]: optionLabel,
            }));

            if (!appdatabase) return;

            try {
                setSendingPollId(pollId);
                await sendToFirebase({
                    type: "poll_vote",
                    pollId,
                    option: optionLabel,
                });
                Alert.alert("Thanks!", "Your vote has been recorded.");
            } catch (e) {
                Alert.alert("Error", "Could not send your vote right now.");
            } finally {
                setSendingPollId(null);
            }
        },
        [appdatabase, sendToFirebase]
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
                                                },
                                            ]}
                                            activeOpacity={0.7}
                                            onPress={() => handlePollVote(poll.id, opt.label)}
                                            disabled={loading}
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
