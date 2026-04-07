import React, { useMemo, useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { getFirestore, collection, addDoc, Timestamp, query as firestoreQuery, where, getDocs } from '@react-native-firebase/firestore';

const REPORT_REASONS = [
  'Scam / Fraud',
  'Inappropriate Content',
  'Harassment / Bullying',
  'Spam',
  'Other',
];

export default function ScamSafetyBox({
  setShowRatingModal,
  canRate,
  hasRated,
  chatKey,
  userId,
  selectedUser,
}) {
  const { theme, user: currentUser, isAdmin, isModerator } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenRating = useCallback(() => {
    if (setShowRatingModal && typeof setShowRatingModal === 'function') {
      setShowRatingModal(true);
    }
  }, [setShowRatingModal]);

  const otherUserId = selectedUser?.senderId || selectedUser?.id;
  const otherUserName = selectedUser?.sender || selectedUser?.displayName || selectedUser?.userName;

  const handleReportPress = useCallback(() => {
    if (!otherUserId || !userId) {
      Alert.alert('Error', 'Cannot report — chat info unavailable.');
      return;
    }
    if (isAdmin || isModerator) {
      Alert.alert('Info', 'Admins and moderators cannot report chats.');
      return;
    }
    setSelectedReason(null);
    setShowReportModal(true);
  }, [otherUserId, userId, isAdmin, isModerator]);

  const handleSubmitReport = useCallback(async () => {
    if (!selectedReason) {
      Alert.alert('Error', 'Please select a reason.');
      return;
    }

    setSubmitting(true);
    try {
      const db = getFirestore();

      // Check if this user already reported this chat
      const existing = await getDocs(
        firestoreQuery(
          collection(db, 'chat_reports'),
          where('chatKey', '==', chatKey),
          where('reportedBy', '==', userId),
          where('status', '==', 'pending'),
        ),
      );

      if (!existing.empty) {
        Alert.alert('Already Reported', 'You have already reported this conversation. A moderator will review it soon.');
        setShowReportModal(false);
        setSubmitting(false);
        return;
      }

      await addDoc(collection(db, 'chat_reports'), {
        chatKey,
        reportedBy: userId,
        reporterName: currentUser?.userName || currentUser?.displayName || 'Unknown',
        reportedUser: otherUserId,
        reportedUserName: otherUserName || 'Unknown',
        reason: selectedReason,
        chatConsent: true,
        status: 'pending',
        createdAt: Timestamp.now(),
      });

      Alert.alert(
        'Report Submitted',
        'Thank you for reporting. A moderator will review this conversation. Your chat consent allows them to view the messages.',
      );
      setShowReportModal(false);
    } catch (err) {
      console.error('Report submit error:', err);
      Alert.alert('Error', 'Could not submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [selectedReason, chatKey, userId, currentUser, otherUserId, otherUserName]);

  return (
    <View style={styles.container}>
      {/* Top row: Warning icon + safety tips inline */}
      <View style={styles.safetyRow}>
        <Text style={styles.warningIcon}>⚠️</Text>
        <Text style={styles.safetyText} numberOfLines={2}>
          {'Too good? It\'s a scam.'} · {'Never share login.'} · {'Use trusted servers.'}
        </Text>
      </View>

      {/* Bottom row: Action chips */}
      {canRate && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.reportChip}
            onPress={handleReportPress}
            activeOpacity={0.7}
          >
            <Ionicons name="flag-outline" size={12} color={isDarkMode ? '#FCA5A5' : '#DC2626'} style={{ marginRight: 4 }} />
            <Text style={styles.reportChipText}>Report Chat</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rateChip}
            onPress={handleOpenRating}
            activeOpacity={0.7}
          >
            <Text style={styles.rateChipIcon}>⭐</Text>
            <Text style={styles.rateChipText}>
              {hasRated ? 'Edit Rating' : 'Rate Trader'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Report Modal */}
      <Modal visible={showReportModal} transparent animationType="fade" onRequestClose={() => setShowReportModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#1C1C1E' : '#FFF' }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="flag" size={22} color="#FF3B30" />
              <Text style={[styles.modalTitle, { color: isDarkMode ? '#FFF' : '#000' }]}>Report Conversation</Text>
              <TouchableOpacity onPress={() => setShowReportModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={isDarkMode ? '#888' : '#666'} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalSubtitle, { color: isDarkMode ? '#AAA' : '#666' }]}>
              Reporting {otherUserName || 'this user'}
            </Text>

            <Text style={[styles.modalLabel, { color: isDarkMode ? '#CCC' : '#333' }]}>Select a reason:</Text>

            <ScrollView style={{ maxHeight: 220 }}>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason}
                  style={[
                    styles.reasonOption,
                    {
                      backgroundColor: selectedReason === reason
                        ? (isDarkMode ? 'rgba(255,59,48,0.2)' : 'rgba(255,59,48,0.1)')
                        : (isDarkMode ? '#2C2C2E' : '#F2F2F7'),
                      borderColor: selectedReason === reason ? '#FF3B30' : (isDarkMode ? '#3A3A3C' : '#E5E5EA'),
                    },
                  ]}
                  onPress={() => setSelectedReason(reason)}
                >
                  <Ionicons
                    name={selectedReason === reason ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={selectedReason === reason ? '#FF3B30' : (isDarkMode ? '#666' : '#999')}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={{ color: isDarkMode ? '#FFF' : '#000', fontSize: 14 }}>{reason}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={[styles.consentBox, { backgroundColor: isDarkMode ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)', borderColor: isDarkMode ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.2)' }]}>
              <Ionicons name="eye-outline" size={16} color="#3B82F6" style={{ marginRight: 8 }} />
              <Text style={[styles.consentText, { color: isDarkMode ? '#93C5FD' : '#1D4ED8' }]}>
                By reporting, you allow moderators to view this conversation to investigate.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { opacity: submitting || !selectedReason ? 0.5 : 1 }]}
              onPress={handleSubmitReport}
              disabled={submitting || !selectedReason}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.submitButtonText}>Submit Report</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 6,
      marginVertical: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(30,41,59,0.85)' : 'rgba(255,251,235,0.9)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(71,85,105,0.5)' : 'rgba(251,191,119,0.4)',
    },

    /* ── Safety row ── */
    safetyRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    warningIcon: {
      fontSize: 13,
      marginRight: 6,
    },
    safetyText: {
      flex: 1,
      fontSize: 10,
      lineHeight: 14,
      color: isDark ? '#CBD5E1' : '#78716C',
      letterSpacing: 0.1,
    },

    /* ── Actions row ── */
    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 7,
      gap: 6,
    },

    /* Report chip */
    reportChip: {
      flex: 1,
      minWidth: 100,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)',
      backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.06)',
    },
    reportChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDark ? '#FCA5A5' : '#DC2626',
    },

    /* Rate chip */
    rateChip: {
      flex: 1,
      minWidth: 100,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.12)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(251,191,36,0.35)' : 'rgba(251,191,36,0.3)',
    },
    rateChipIcon: {
      fontSize: 11,
      marginRight: 4,
    },
    rateChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDark ? '#FCD34D' : '#B45309',
    },

    /* ── Report Modal ── */
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContent: {
      width: '100%',
      maxWidth: 400,
      borderRadius: 16,
      padding: 20,
      maxHeight: '80%',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '700',
      flex: 1,
      marginLeft: 8,
    },
    modalSubtitle: {
      fontSize: 13,
      marginBottom: 16,
    },
    modalLabel: {
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 10,
    },
    reasonOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      marginBottom: 6,
    },
    consentBox: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      marginTop: 14,
      marginBottom: 16,
    },
    consentText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 16,
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FF3B30',
      paddingVertical: 12,
      borderRadius: 12,
    },
    submitButtonText: {
      color: '#FFF',
      fontSize: 15,
      fontWeight: '700',
    },
  });
