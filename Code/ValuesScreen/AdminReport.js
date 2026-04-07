// NewsFeedbackReport.js
import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { ref, get } from "@react-native-firebase/database";
import { useGlobalState } from "../GlobelStats";
import config from "../Helper/Environment";

const NewsFeedbackReport = () => {
  const { appdatabase, theme } = useGlobalState();
  const isDark = theme === "dark";

  const palette = useMemo(
    () =>
      isDark
        ? {
          background: "#000000",
          card: "#10151A",
          border: "rgba(255,255,255,0.20)",
          textPrimary: "#FFFFFF",
          textSecondary: "#D5E2DC",
          chipBg: "#141C20",
        }
        : {
          background: "#f3f7f5",
          card: "#ffffff",
          border: "rgba(0,0,0,0.06)",
          textPrimary: "#0b1510",
          textSecondary: "#4c6357",
          chipBg: "#edf5f1",
        },
    [isDark]
  );

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pollStats, setPollStats] = useState([]);
  const [quickTop, setQuickTop] = useState([]);
  const [customLatest, setCustomLatest] = useState([]);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [showAllFeedback, setShowAllFeedback] = useState(false);

  const fetchData = async (isRefresh = false) => {
    if (!appdatabase) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [pollsSnap, fbSnap] = await Promise.all([
        get(ref(appdatabase, "news/polls")),
        get(ref(appdatabase, "news_feedback")),
      ]);

      const pollsData = pollsSnap.val() || {};
      const feedbackData = fbSnap.val() || {};
      const summary = buildSummary(feedbackData, pollsData);

      setPollStats(summary.pollStats);
      setQuickTop(summary.quickTop);
      setCustomLatest(summary.customLatest);
    } catch (err) {
      console.warn("[AdminReport] fetch error:", err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [appdatabase]);

  if (!appdatabase) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <Text style={[styles.infoText, { color: palette.textSecondary }]}>
          No database instance found.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="small" color={config.colors.hasBlockGreen} />
        <Text style={[styles.infoText, { color: palette.textSecondary }]}>
          Loading feedback summary...
        </Text>
      </View>
    );
  }

  const hasAnyData =
    pollStats.length > 0 || quickTop.length > 0 || customLatest.length > 0;

  if (!hasAnyData) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <Text style={[styles.infoText, { color: palette.textSecondary }]}>
          No feedback yet.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => fetchData(true)}
          tintColor={config.colors.hasBlockGreen}
        />
      }
    >
      <Text style={[styles.screenTitle, { color: palette.textPrimary }]}>
        Feedback summary
      </Text>
      <Text style={[styles.screenSubtitle, { color: palette.textSecondary }]}>
        Poll winners, popular suggestions and latest detailed feedback.
      </Text>

      {/* ── Poll Results ── */}
      {pollStats.length > 0 && (
        <View
          style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            Poll results
          </Text>

          {pollStats.map((poll) => (
            <View key={poll.pollId} style={[styles.pollBlock, { borderColor: palette.border }]}>
              <Text style={[styles.pollQuestion, { color: palette.textPrimary }]}>
                {poll.question || `Poll ${poll.pollId}`}
              </Text>

              <Text style={[styles.pollMeta, { color: palette.textSecondary }]}>
                Total votes: {poll.totalVotes || 0}
              </Text>

              {poll.winners.length > 0 && (
                <Text style={[styles.pollWinner, { color: config.colors.hasBlockGreen }]}>
                  Winner:{" "}
                  {poll.winners.length === 1
                    ? poll.winners[0]
                    : poll.winners.join(" • ")}{" "}
                  {poll.winners.length > 1 ? "(tie)" : ""}
                </Text>
              )}

              {poll.options.map((opt) => (
                <View key={opt.label} style={styles.optionRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={[styles.optionLabel, { color: palette.textPrimary }]}>
                        {opt.label}
                      </Text>
                      <Text style={[styles.optionMeta, { color: palette.textSecondary }]}>
                        {opt.count} vote{opt.count !== 1 ? "s" : ""} • {opt.percent.toFixed(1)}%
                      </Text>
                    </View>
                    {/* Progress bar */}
                    <View style={[styles.barBg, { backgroundColor: palette.chipBg }]}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.max(2, opt.percent)}%`,
                            backgroundColor: opt.count === (poll.options[0]?.count || 0)
                              ? config.colors.hasBlockGreen
                              : isDark ? "#334155" : "#cbd5e1",
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* ── Top Quick Suggestions ── */}
      {quickTop.length > 0 && (
        <View
          style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            Top quick suggestions
          </Text>

          {(showAllSuggestions ? quickTop : quickTop.slice(0, 15)).map((item) => (
            <View key={item.text} style={styles.quickRow}>
              <View
                style={[styles.countBadge, { backgroundColor: palette.chipBg, borderColor: palette.border }]}
              >
                <Text style={[styles.countBadgeText, { color: config.colors.hasBlockGreen }]}>
                  {item.count}×
                </Text>
              </View>
              <Text style={[styles.quickText, { color: palette.textPrimary }]}>
                {item.text}
              </Text>
            </View>
          ))}
          {quickTop.length > 15 && (
            <TouchableOpacity
              style={styles.showAllBtn}
              onPress={() => setShowAllSuggestions((p) => !p)}
            >
              <Text style={[styles.showAllText, { color: config.colors.hasBlockGreen }]}>
                {showAllSuggestions ? "Show Less" : `Show All (${quickTop.length})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Latest Custom Feedback ── */}
      {customLatest.length > 0 && (
        <View
          style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            Latest detailed feedback
          </Text>

          {(showAllFeedback ? customLatest : customLatest.slice(0, 20)).map((item) => (
            <View key={item.id} style={[styles.customRow, { borderColor: palette.border }]}>
              <Text style={[styles.customMeta, { color: palette.textSecondary }]}>
                {item.userName || "anonymous"} • {formatShortDate(item.createdAt)}
              </Text>
              <Text style={[styles.customText, { color: palette.textPrimary }]}>
                {item.text}
              </Text>
            </View>
          ))}
          {customLatest.length > 20 && (
            <TouchableOpacity
              style={styles.showAllBtn}
              onPress={() => setShowAllFeedback((p) => !p)}
            >
              <Text style={[styles.showAllText, { color: config.colors.hasBlockGreen }]}>
                {showAllFeedback ? "Show Less" : `Show All (${customLatest.length})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
};

/**
 * Build high-level summary:
 * - Poll stats (winner, counts, percentages)
 * - Quick suggestions grouped by text
 * - Custom feedback latest first
 */
function buildSummary(feedbackRaw, pollsRaw) {
  const pollDefs = {};

  Object.entries(pollsRaw || {}).forEach(([pollId, poll]) => {
    pollDefs[pollId] = {
      pollId,
      question: poll.question || `Poll ${pollId}`,
    };
  });

  const pollStatsMap = {};
  const quickCountMap = {};
  const customItems = [];

  Object.entries(feedbackRaw || {}).forEach(([id, entry]) => {
    const { type } = entry;

    if (type === "poll_vote") {
      const pollId = entry.pollId || "unknown";
      const optionLabel = entry.option || "Unknown option";

      if (!pollStatsMap[pollId]) {
        pollStatsMap[pollId] = {
          pollId,
          question: pollDefs[pollId]?.question || `Poll ${pollId}`,
          totalVotes: 0,
          options: {},
        };
      }

      const poll = pollStatsMap[pollId];
      poll.totalVotes += 1;
      poll.options[optionLabel] = (poll.options[optionLabel] || 0) + 1;
    }

    if (type === "quick_suggestion") {
      const text = (entry.text || "").trim();
      if (!text) return;
      quickCountMap[text] = (quickCountMap[text] || 0) + 1;
    }

    if (type === "custom_feedback") {
      const text = (entry.text || "").trim();
      if (!text) return;
      customItems.push({
        id,
        text,
        userName: entry.userName || null,
        createdAt: entry.createdAt || 0,
      });
    }
  });

  // Build pollStats with winners + percentages
  const pollStats = Object.values(pollStatsMap).map((poll) => {
    const optionsArr = Object.entries(poll.options).map(([label, count]) => ({
      label,
      count,
      percent: poll.totalVotes > 0 ? (count / poll.totalVotes) * 100 : 0,
    }));

    optionsArr.sort((a, b) => b.count - a.count);

    const maxCount = optionsArr[0]?.count || 0;
    const winners = optionsArr
      .filter((o) => o.count === maxCount && maxCount > 0)
      .map((o) => o.label);

    return {
      pollId: poll.pollId,
      question: poll.question,
      totalVotes: poll.totalVotes,
      options: optionsArr,
      winners,
    };
  });

  pollStats.sort((a, b) => b.totalVotes - a.totalVotes);

  const quickTop = Object.entries(quickCountMap)
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);

  customItems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { pollStats, quickTop, customLatest: customItems };
}

function formatShortDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  infoText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: "center",
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 2,
  },
  screenSubtitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  sectionCard: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },

  // Polls
  pollBlock: {
    marginBottom: 12,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  pollQuestion: {
    fontSize: 14,
    fontWeight: "bold",
  },
  pollMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  pollWinner: {
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 4,
    marginBottom: 4,
  },
  optionRow: {
    marginTop: 6,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  optionMeta: {
    fontSize: 11,
  },
  barBg: {
    height: 6,
    borderRadius: 3,
    marginTop: 4,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },

  // Quick suggestions
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  countBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    marginRight: 8,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  quickText: {
    flex: 1,
    fontSize: 13,
  },

  // Custom feedback
  customRow: {
    marginTop: 8,
    borderTopWidth: 1,
    paddingTop: 6,
  },
  customMeta: {
    fontSize: 11,
    marginBottom: 2,
  },
  customText: {
    fontSize: 13,
  },
  showAllBtn: {
    alignSelf: "center",
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  showAllText: {
    fontSize: 13,
    fontWeight: "bold",
  },
});

export default NewsFeedbackReport;
