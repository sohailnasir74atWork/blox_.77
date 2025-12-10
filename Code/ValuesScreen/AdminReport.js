// NewsFeedbackReport.js
import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { ref, onValue } from "@react-native-firebase/database";
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
  const [groupedUsers, setGroupedUsers] = useState([]);

  useEffect(() => {
    if (!appdatabase) return;

    const fbRef = ref(appdatabase, "news_feedback");

    const unsubscribe = onValue(fbRef, (snap) => {
      const data = snap.val() || {};
      const grouped = groupFeedbackByUser(data);
      setGroupedUsers(grouped);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [appdatabase]);

  if (!appdatabase) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: palette.background },
        ]}
      >
        <Text style={[styles.infoText, { color: palette.textSecondary }]}>
          No database instance found.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: palette.background },
        ]}
      >
        <ActivityIndicator
          size="small"
          color={config.colors.hasBlockGreen}
        />
        <Text style={[styles.infoText, { color: palette.textSecondary }]}>
          Loading feedback report...
        </Text>
      </View>
    );
  }

  if (groupedUsers.length === 0) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: palette.background },
        ]}
      >
        <Text style={[styles.infoText, { color: palette.textSecondary }]}>
          No user feedback found yet.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text
        style={[
          styles.screenTitle,
          { color: palette.textPrimary },
        ]}
      >
        Feedback report
      </Text>
      <Text
        style={[
          styles.screenSubtitle,
          { color: palette.textSecondary },
        ]}
      >
        Grouped by user • poll votes, quick suggestions and custom feedback.
      </Text>

      {groupedUsers.map((user) => (
        <View
          key={user.userKey}
          style={[
            styles.userCard,
            {
              backgroundColor: palette.card,
              borderColor: palette.border,
            },
          ]}
        >
          {/* User header */}
          <View style={styles.userHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.userName,
                  { color: palette.textPrimary },
                ]}
                numberOfLines={1}
              >
                {user.userName}
              </Text>
              <Text
                style={[
                  styles.userId,
                  { color: palette.textSecondary },
                ]}
                numberOfLines={1}
              >
                ID: {user.userId || "anonymous"}
              </Text>
            </View>

            <View style={styles.statsRow}>
              <StatChip
                label="Polls"
                value={user.stats.pollVotes}
                palette={palette}
              />
              <StatChip
                label="Quick"
                value={user.stats.quickSuggestions}
                palette={palette}
              />
              <StatChip
                label="Custom"
                value={user.stats.customFeedback}
                palette={palette}
              />
            </View>
          </View>

          {/* Individual feedback items */}
          {user.items.map((item) => (
            <View
              key={item.id}
              style={[
                styles.itemRow,
                { borderColor: palette.border },
              ]}
            >
              <View style={styles.itemLeft}>
                <Text
                  style={[
                    styles.itemType,
                    { color: palette.textSecondary },
                  ]}
                >
                  {formatTypeLabel(item)}
                </Text>
                <Text
                  style={[
                    styles.itemText,
                    { color: palette.textPrimary },
                  ]}
                >
                  {item.type === "poll_vote"
                    ? item.option
                    : item.text}
                </Text>
              </View>

              <Text
                style={[
                  styles.itemDate,
                  { color: palette.textSecondary },
                ]}
              >
                {formatShortDate(item.createdAt)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
};

/**
 * Helper: group flat /news_feedback object by userId + userName
 */
function groupFeedbackByUser(raw) {
  const byUser = {};

  Object.entries(raw).forEach(([id, entry]) => {
    const userId = entry.userId || "anonymous";
    const userName = entry.userName || "Anonymous";
    const userKey = `${userId}__${userName}`;

    if (!byUser[userKey]) {
      byUser[userKey] = {
        userKey,
        userId,
        userName,
        items: [],
      };
    }

    byUser[userKey].items.push({
      id,
      ...entry,
    });
  });

  // Final array with stats & sorting
  return Object.values(byUser)
    .map((u) => {
      const itemsSorted = [...u.items].sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
      );

      const stats = {
        pollVotes: itemsSorted.filter(
          (i) => i.type === "poll_vote"
        ).length,
        quickSuggestions: itemsSorted.filter(
          (i) => i.type === "quick_suggestion"
        ).length,
        customFeedback: itemsSorted.filter(
          (i) => i.type === "custom_feedback"
        ).length,
      };

      const last = itemsSorted[itemsSorted.length - 1];
      const lastAt = last?.createdAt || 0;

      return {
        ...u,
        items: itemsSorted,
        stats,
        lastAt,
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt); // newest active users first
}

function formatTypeLabel(item) {
  if (item.type === "poll_vote") {
    return `Poll • ${item.pollId || "unknown"}`;
  }
  if (item.type === "quick_suggestion") return "Quick suggestion";
  if (item.type === "custom_feedback") return "Custom feedback";
  return item.type || "Unknown";
}

function formatShortDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const StatChip = ({ label, value, palette }) => {
  return (
    <View
      style={[
        styles.statChip,
        {
          backgroundColor: palette.chipBg,
          borderColor: palette.border,
        },
      ]}
    >
      <Text
        style={[
          styles.statValue,
          { color: config.colors.hasBlockGreen },
        ]}
      >
        {value}
      </Text>
      <Text
        style={[
          styles.statLabel,
          { color: palette.textSecondary },
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

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
    fontFamily: "Lato-Regular",
    textAlign: "center",
  },
  screenTitle: {
    fontSize: 20,
    fontFamily: "Lato-Bold",
    marginBottom: 2,
  },
  screenSubtitle: {
    fontSize: 13,
    fontFamily: "Lato-Regular",
    marginBottom: 12,
  },
  userCard: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  userHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    alignItems: "center",
  },
  userName: {
    fontSize: 16,
    fontFamily: "Lato-Bold",
  },
  userId: {
    fontSize: 11,
    fontFamily: "Lato-Regular",
    marginTop: 2,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  statChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    marginLeft: 4,
    alignItems: "center",
  },
  statValue: {
    fontSize: 13,
    fontFamily: "Lato-Bold",
  },
  statLabel: {
    fontSize: 10,
    fontFamily: "Lato-Regular",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 6,
    marginTop: 6,
  },
  itemLeft: {
    flex: 1,
    paddingRight: 8,
  },
  itemType: {
    fontSize: 11,
    fontFamily: "Lato-Bold",
    marginBottom: 2,
  },
  itemText: {
    fontSize: 13,
    fontFamily: "Lato-Regular",
  },
  itemDate: {
    fontSize: 11,
    fontFamily: "Lato-Regular",
    marginLeft: 6,
    alignSelf: "flex-start",
  },
});

export default NewsFeedbackReport;
