/**
 * ScammerDatabaseScreen.js
 * Kid-safe Scammer reporting & browsing screen for Adopt Me trading app.
 *
 * Features:
 *  - Safety banner
 *  - Search by Roblox username
 *  - Paginated list (20 at a time)
 *  - Detail modal (fetched on tap, cached in memory)
 *  - Report form modal with Bunny CDN image upload
 *  - Mod/Admin approve/reject
 *  - Rate limit: 1 report per user per 24h
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    FlatList,
    Modal,
    Image,
    Alert,
    ActivityIndicator,
    StyleSheet,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    RefreshControl,
    UIManager,
    LayoutAnimation,
    Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    serverTimestamp,
    Timestamp,
    runTransaction,
} from '@react-native-firebase/firestore';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { Image as CompressorImage } from 'react-native-compressor';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import InterstitialAdManager from '../Ads/IntAd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);



// ── Bunny CDN ──
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const base64ToBytes = (base64) => {
    if (!base64 || typeof base64 !== 'string') throw new Error('Invalid base64');
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const str = base64.replace(/[\r\n]+/g, '');
    const output = [];
    let i = 0;
    while (i < str.length) {
        const e1 = chars.indexOf(str.charAt(i++));
        const e2 = chars.indexOf(str.charAt(i++));
        const e3 = chars.indexOf(str.charAt(i++));
        const e4 = chars.indexOf(str.charAt(i++));
        if (e1 === -1 || e2 === -1) break;
        output.push((e1 << 2) | (e2 >> 4));
        if (e3 !== 64) output.push(((e2 & 15) << 4) | (e3 >> 2));
        if (e4 !== 64 && e3 !== 64) output.push(((e3 & 3) << 6) | e4);
    }
    return Uint8Array.from(output);
};

const PAGE_SIZE = 15;
const SCAM_TYPES = ['Trust trade', 'Switch scam', 'Fail trade', 'Other'];
const PERSONAL_INFO_REGEX = /(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b|\b\d{7,15}\b|discord|instagram|snapchat|whatsapp|telegram|tiktok)/i;

// ── Helper: format date ──
const fmtDate = (ts) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return dayjs(d).format('MMM D, YYYY');
};
const fmtAgo = (ts) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return dayjs(d).fromNow();
};

// ── Status badge colors ──
const statusColor = (s) => {
    switch (s) {
        case 'verified': return '#FF3B30';
        default: return '#FF9500';
    }
};
const statusLabel = (s) => {
    switch (s) {
        case 'verified': return 'Verified Scammer';
        default: return 'Unverified';
    }
};

const FILTERS = ['All', 'Verified', 'Unverified'];

// ════════════════════════════════════════════════════════
//  COMPONENT
// ════════════════════════════════════════════════════════
const ScammerDatabaseScreen = () => {
    const { theme, user, isAdmin } = useGlobalState();
    const { localState } = useLocalState();
    const isDark = theme === 'dark';
    const isMod = isAdmin || user?.isModerator || user?.isMod;

    const db = useMemo(() => getFirestore(), []);

    // ── List state ──
    const [summaries, setSummaries] = useState([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [lastDoc, setLastDoc] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [searchText, setSearchText] = useState('');
    const [activeFilter, setActiveFilter] = useState('All');

    // ── Detail modal state ──
    const [selectedReport, setSelectedReport] = useState(null);
    const [detailData, setDetailData] = useState(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [showDetailModal, setShowDetailModal] = useState(false);

    // ── Report form state ──
    const [showReportModal, setShowReportModal] = useState(false);
    const [reportUsername, setReportUsername] = useState('');
    const [reportScamType, setReportScamType] = useState(SCAM_TYPES[0]);
    const [reportWhat, setReportWhat] = useState('');
    const [reportScamDate, setReportScamDate] = useState('');
    const [reportImages, setReportImages] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [uploadingImages, setUploadingImages] = useState(false);

    // ── Cache for details ──
    const detailsCache = useRef({});

    // ── Loading action for mod ──
    const [modAction, setModAction] = useState(null); // 'approve' | 'reject' | null

    // ── Fullscreen image viewer ──
    const [fullscreenImage, setFullscreenImage] = useState(null);

    // ════════════════════════════════════════
    //  FETCH SUMMARIES (paginated)
    // ════════════════════════════════════════
    const fetchSummariesPage = useCallback(async (reset = false, filter = activeFilter) => {
        if (loading) return;
        if (!reset && !hasMore) return;
        setLoading(true);
        try {
            const ref = collection(db, 'scammerSummaries');
            const constraints = [orderBy('reportCount', 'desc'), orderBy('updatedAt', 'desc'), limit(PAGE_SIZE)];

            // Apply filter
            if (filter === 'Verified') constraints.unshift(where('status', '==', 'verified'));
            else if (filter === 'Unverified') constraints.unshift(where('status', '==', 'unverified'));

            if (!reset && lastDoc) constraints.push(startAfter(lastDoc));

            const q = query(ref, ...constraints);
            const snap = await getDocs(q);
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

            if (reset) {
                setSummaries(list);
            } else {
                setSummaries((prev) => [...prev, ...list]);
            }
            setLastDoc(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);
            setHasMore(snap.docs.length === PAGE_SIZE);
            setIsSearchMode(false);
        } catch (err) {
            console.error('[Scammer] Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [db, loading, hasMore, lastDoc, activeFilter]);

    // ════════════════════════════════════════
    //  SEARCH
    // ════════════════════════════════════════
    const searchSummaries = useCallback(async (text) => {
        const q_lc = text.trim().toLowerCase();
        if (!q_lc) {
            setIsSearchMode(false);
            fetchSummariesPage(true);
            return;
        }
        setLoading(true);
        setIsSearchMode(true);
        try {
            const ref = collection(db, 'scammerSummaries');
            // prefix match
            const q = query(
                ref,
                where('reportedUsername_lc', '>=', q_lc),
                where('reportedUsername_lc', '<=', q_lc + '\uf8ff'),
                orderBy('reportedUsername_lc'),
                limit(PAGE_SIZE),
            );
            const snap = await getDocs(q);
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setSummaries(list);
            setHasMore(false); // search doesn't paginate
        } catch (err) {
            console.error('[Scammer] Search error:', err);
        } finally {
            setLoading(false);
        }
    }, [db, fetchSummariesPage]);

    // ════════════════════════════════════════
    //  REFRESH
    // ════════════════════════════════════════
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        setLastDoc(null);
        setHasMore(true);
        if (isSearchMode && searchText.trim()) {
            await searchSummaries(searchText);
        } else {
            setIsSearchMode(false);
            await fetchSummariesPage(true, activeFilter);
        }
        setRefreshing(false);
    }, [db, isSearchMode, searchText, searchSummaries, fetchSummariesPage, activeFilter]);

    // Auto-load on first render
    const didFirstLoad = useRef(false);
    if (!didFirstLoad.current) {
        didFirstLoad.current = true;
        setTimeout(() => fetchSummariesPage(true), 100);
    }

    // ════════════════════════════════════════
    //  DETAIL (fetch on tap, cache)
    // ════════════════════════════════════════
    const fetchDetails = useCallback(async (reportId) => {
        // check cache
        if (detailsCache.current[reportId]) {
            setDetailData(detailsCache.current[reportId]);
            return;
        }
        setLoadingDetail(true);
        try {
            const snap = await getDoc(doc(db, 'scammerDetails', reportId));
            if (snap.exists) {
                const data = { id: snap.id, ...snap.data() };
                detailsCache.current[reportId] = data;
                setDetailData(data);
            } else {
                setDetailData(null);
            }
        } catch (err) {
            console.error('[Scammer] Detail fetch error:', err);
        } finally {
            setLoadingDetail(false);
        }
    }, [db]);

    const openDetail = useCallback((item) => {
        setSelectedReport(item);
        setDetailData(null);
        setShowDetailModal(true);
        fetchDetails(item.id);
    }, [fetchDetails]);

    // ════════════════════════════════════════
    //  UPLOAD IMAGE TO BUNNY
    // ════════════════════════════════════════
    const uploadToBunny = useCallback(async (imagePath) => {
        const localPath = imagePath.startsWith('file://') ? imagePath.replace('file://', '') : imagePath;
        const b64 = await RNFS.readFile(localPath, 'base64');
        const bytes = base64ToBytes(b64);
        const fileName = `scam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
        const remotePath = `scammer/${fileName}`;
        const res = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
            method: 'PUT',
            headers: { AccessKey: BUNNY_ACCESS_KEY, 'Content-Type': 'image/jpeg' },
            body: bytes,
        });
        if (!res.ok) throw new Error('Bunny upload failed');
        return `${BUNNY_CDN_BASE}/${remotePath}`;
    }, []);

    // ════════════════════════════════════════
    //  PICK PROOF IMAGES
    // ════════════════════════════════════════
    const handlePickProofImage = useCallback(() => {
        if (reportImages.length >= 3) {
            Alert.alert(t('scammer.limit_title'), t('scammer.limit_max_images'));
            return;
        }
        launchImageLibrary(
            { mediaType: 'photo', selectionLimit: 3 - reportImages.length, quality: 0.7, maxWidth: 1024, maxHeight: 1024 },
            async (response) => {
                if (!response || response.didCancel || response.errorCode) return;
                const assets = response?.assets || [];
                const uris = [];
                for (const asset of assets) {
                    if (!asset?.uri) continue;
                    try {
                        const fileSize = asset.fileSize || 0;
                        let uri = asset.uri;
                        if (fileSize > 1024 * 1024) {
                            try {
                                uri = await CompressorImage.compress(uri, { maxWidth: 800, quality: 0.6, returnableOutputType: 'uri' });
                            } catch { /* use original */ }
                        }
                        uris.push(uri);
                    } catch { /* skip */ }
                }
                if (uris.length > 0) {
                    setReportImages((prev) => [...prev, ...uris].slice(0, 3));
                }
            },
        );
    }, [reportImages.length]);

    // ════════════════════════════════════════
    //  SUBMIT REPORT (with rate limit)
    // ════════════════════════════════════════
    const submitReport = useCallback(async () => {
        if (!user?.id) { Alert.alert(t('scammer.sign_in_title'), t('scammer.sign_in_msg')); return; }

        const username = reportUsername.trim();
        if (!username || username.length < 3 || username.length > 30) {
            Alert.alert(t('scammer.error_title'), t('scammer.error_username_length')); return;
        }
        if (!reportScamDate.trim()) {
            Alert.alert(t('scammer.error_title'), t('scammer.error_scam_date')); return;
        }
        const whatText = reportWhat.trim();
        if (!whatText || whatText.length < 10) {
            Alert.alert(t('scammer.error_title'), t('scammer.error_description_short')); return;
        }
        if (whatText.length > 200) {
            Alert.alert(t('scammer.error_title'), t('scammer.error_description_long')); return;
        }
        if (PERSONAL_INFO_REGEX.test(whatText)) {
            Alert.alert(t('scammer.safety_title'), t('scammer.safety_personal_info')); return;
        }

        setSubmitting(true);

        // Core submit logic — called directly (Pro) or after ad (non-Pro)
        const doSubmit = async () => {
            try {
                // Parse scam date (try multiple common formats)
                const dateStr = reportScamDate.trim();
                const formats = [
                    'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY',
                    'D/M/YYYY', 'M/D/YYYY',
                    'DD-MM-YYYY', 'MM-DD-YYYY',
                    'MMM D, YYYY', 'MMMM D, YYYY',
                    'D MMM YYYY', 'D MMMM YYYY',
                    'MMM D YYYY', 'MMMM D YYYY',
                ];
                let parsed = dayjs(dateStr, formats, true);
                // Fallback: let dayjs try native parsing
                if (!parsed.isValid()) parsed = dayjs(dateStr);
                if (!parsed.isValid()) {
                    Alert.alert('Error', 'Invalid date format. Try: Jan 5, 2025');
                    setSubmitting(false);
                    return;
                }
                const scamTimestamp = Timestamp.fromDate(parsed.toDate());

                // Upload images
                let proofUrls = [];
                if (reportImages.length > 0) {
                    setUploadingImages(true);
                    try {
                        const uploads = reportImages.map((uri) => uploadToBunny(uri));
                        proofUrls = (await Promise.all(uploads)).filter(Boolean);
                    } catch (err) {
                        console.error('Image upload error:', err);
                        Alert.alert('Error', 'Failed to upload images. Try again.');
                        setSubmitting(false);
                        setUploadingImages(false);
                        return;
                    }
                    setUploadingImages(false);
                }

                // Transaction: rate limit check + create report
                await runTransaction(db, async (tx) => {
                    const rateLimitRef = doc(db, 'userRateLimits', user.id);
                    const rateLimitSnap = await tx.get(rateLimitRef);

                    if (rateLimitSnap.exists) {
                        const lastAt = rateLimitSnap.data()?.lastReportAt;
                        if (lastAt) {
                            const lastMs = lastAt?.toDate ? lastAt.toDate().getTime() : lastAt;
                            const now = Date.now();
                            if (now - lastMs < 24 * 60 * 60 * 1000) {
                                throw new Error('RATE_LIMIT');
                            }
                        }
                    }

                    const reportId = `${username.toLowerCase()}_${Date.now()}`;
                    const summaryRef = doc(db, 'scammerSummaries', reportId);
                    const detailRef = doc(db, 'scammerDetails', reportId);

                    // Check if this username already has a summary
                    const existingQ = query(
                        collection(db, 'scammerSummaries'),
                        where('reportedUsername_lc', '==', username.toLowerCase()),
                        limit(1)
                    );
                    const existingSnap = await getDocs(existingQ);

                    if (existingSnap.docs.length > 0) {
                        // Increment reportCount on existing summary
                        const existingRef = existingSnap.docs[0].ref;
                        const prevCount = existingSnap.docs[0].data()?.reportCount || 1;
                        tx.update(existingRef, {
                            reportCount: prevCount + 1,
                            updatedAt: Timestamp.now(),
                        });
                    } else {
                        // Create new summary
                        tx.set(summaryRef, {
                            reportedUsername: username,
                            reportedUsername_lc: username.toLowerCase(),
                            status: 'unverified',
                            reportCount: 1,
                            scamDate: scamTimestamp,
                            createdAt: Timestamp.now(),
                            updatedAt: Timestamp.now(),
                        });
                    }

                    tx.set(detailRef, {
                        scamType: reportScamType,
                        whatHappened: whatText,
                        proofUrls,
                        reporterUid: user.id,
                        reportedUsername_lc: username.toLowerCase(),
                    });

                    tx.set(rateLimitRef, { lastReportAt: Timestamp.now() }, { merge: true });
                });

                Alert.alert('Report Submitted', 'Your report has been submitted for review. Thank you!');
                // Reset form
                setReportUsername('');
                setReportScamType(SCAM_TYPES[0]);
                setReportWhat('');
                setReportScamDate('');
                setReportImages([]);
                setShowReportModal(false);
                // Refresh list
                handleRefresh();
            } catch (err) {
                if (err?.message === 'RATE_LIMIT') {
                    Alert.alert('Limit Reached', 'You can only submit 1 report per 24 hours.');
                } else {
                    console.error('[Scammer] Submit error:', err);
                    Alert.alert('Error', 'Failed to submit report. Please try again.');
                }
            } finally {
                setSubmitting(false);
                setUploadingImages(false);
            }
        };

        // Show interstitial ad for non-Pro users, then submit
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (!localState.isPro) {
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            try {
                                InterstitialAdManager.showAd(doSubmit);
                            } catch (err) {
                                console.warn('[AdManager] Failed to show ad:', err);
                                doSubmit();
                            }
                        }, 400);
                    });
                } else {
                    doSubmit();
                }
            }, 500);
        });
    }, [db, user, reportUsername, reportScamType, reportWhat, reportScamDate, reportImages, uploadToBunny, handleRefresh, localState.isPro]);

    // ════════════════════════════════════════
    //  APPROVE / REJECT (mod/admin)
    // ════════════════════════════════════════
    const approveReport = useCallback(async (reportId) => {
        if (!isMod) return;
        setModAction('approve');
        try {
            const summaryRef = doc(db, 'scammerSummaries', reportId);
            const detailRef = doc(db, 'scammerDetails', reportId);
            await updateDoc(summaryRef, { status: 'verified', updatedAt: Timestamp.now() });
            await updateDoc(detailRef, { verifiedByUid: user?.id, verifiedAt: Timestamp.now() });
            // Update local state
            setSummaries((prev) => prev.map((s) => s.id === reportId ? { ...s, status: 'verified' } : s));
            if (selectedReport?.id === reportId) setSelectedReport((p) => ({ ...p, status: 'verified' }));
            // Invalidate cache
            delete detailsCache.current[reportId];
            Alert.alert('Done', 'Report verified and marked as confirmed scammer.');
        } catch (err) {
            console.error('[Scammer] Approve error:', err);
            Alert.alert('Error', 'Failed to approve report.');
        } finally {
            setModAction(null);
        }
    }, [db, isMod, user, selectedReport]);

    const rejectReport = useCallback(async (reportId) => {
        if (!isMod) return;
        Alert.alert('Delete Report', 'This will permanently delete the report. Continue?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive', onPress: async () => {
                    setModAction('reject');
                    try {
                        const summaryRef = doc(db, 'scammerSummaries', reportId);
                        const detailRef = doc(db, 'scammerDetails', reportId);
                        await deleteDoc(summaryRef);
                        await deleteDoc(detailRef);
                        // Remove from local state
                        setSummaries((prev) => prev.filter((s) => s.id !== reportId));
                        delete detailsCache.current[reportId];
                        setShowDetailModal(false);
                        setSelectedReport(null);
                        setDetailData(null);
                        Alert.alert('Done', 'Report deleted.');
                    } catch (err) {
                        console.error('[Scammer] Delete error:', err);
                        Alert.alert('Error', 'Failed to delete report.');
                    } finally {
                        setModAction(null);
                    }
                },
            },
        ]);
    }, [db, isMod]);

    // ════════════════════════════════════════
    //  COLORS
    // ════════════════════════════════════════
    const C = useMemo(() => ({
        bg: isDark ? '#0f172a' : '#F2F2F7',
        card: isDark ? '#1e293b' : '#FFF',
        border: isDark ? '#2C2C2E' : '#E5E5EA',
        text: isDark ? '#FFF' : '#000',
        sub: isDark ? '#8E8E93' : '#666',
        muted: isDark ? '#555' : '#CCC',
        input: isDark ? '#2C2C2E' : '#F2F2F7',
        bannerBg: '#FFF3CD',
        bannerText: '#856404',
    }), [isDark]);

    // ════════════════════════════════════════
    //  RENDER: List item
    // ════════════════════════════════════════
    const renderItem = useCallback(({ item }) => (
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => openDetail(item)}
            style={[s.listItem, { backgroundColor: C.card, borderColor: C.border }]}
        >
            <View style={s.listRow}>
                <View style={s.listLeft}>
                    <Icon name="person-circle-outline" size={28} color={C.sub} style={{ marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                        <Text style={[s.listUsername, { color: C.text }]} numberOfLines={1}>
                            {item.reportedUsername}
                            {(item.reportCount || 1) > 1 && (
                                <Text style={{ color: '#FF3B30', fontSize: 12, fontWeight: '700' }}>
                                    {' '}({item.reportCount} reports)
                                </Text>
                            )}
                        </Text>
                        <Text style={[s.listDate, { color: C.sub }]}>
                            {item.scamDate ? fmtDate(item.scamDate) : fmtAgo(item.createdAt)}
                        </Text>
                    </View>
                </View>
                <View style={[s.badge, { backgroundColor: statusColor(item.status) + '20' }]}>
                    <View style={[s.badgeDot, { backgroundColor: statusColor(item.status) }]} />
                    <Text style={[s.badgeText, { color: statusColor(item.status) }]}>{statusLabel(item.status)}</Text>
                </View>
            </View>
        </TouchableOpacity>
    ), [C, openDetail]);

    // ════════════════════════════════════════
    //  RENDER: List footer
    // ════════════════════════════════════════
    const ListFooter = useMemo(() => {
        if (loading && summaries.length > 0) {
            return <ActivityIndicator size="small" color="#007AFF" style={{ padding: 16 }} />;
        }
        if (summaries.length === 0 && !loading) {
            return <Text style={[s.emptyText, { color: C.muted }]}>No reports found.</Text>;
        }
        return null;
    }, [loading, summaries.length, C.muted]);

    // Handle filter change
    const onFilterChange = useCallback((filter) => {
        setActiveFilter(filter);
        setLastDoc(null);
        setHasMore(true);
        setSummaries([]);
        setTimeout(() => fetchSummariesPage(true, filter), 50);
    }, [fetchSummariesPage]);

    // ════════════════════════════════════════
    //  RENDER: MAIN
    // ════════════════════════════════════════
    return (
        <View style={[s.container, { backgroundColor: C.bg }]}>

            {/* ── Safety Banner ── */}
            <View style={[s.banner, { backgroundColor: C.bannerBg }]}>
                <Icon name="warning-outline" size={16} color={C.bannerText} style={{ marginRight: 6 }} />
                <Text style={[s.bannerText, { color: C.bannerText }]}>
                    ⚠️ This database is community-reported. Always trade safely and never share personal info.
                </Text>
            </View>

            {/* ── Search ── */}
            <View style={[s.searchRow, { backgroundColor: C.input, borderColor: C.border }]}>
                {!searchText.length && (
                    <Icon name="search" size={18} color={C.sub} style={{ marginRight: 8 }} />
                )}
                <TextInput
                    value={searchText}
                    onChangeText={setSearchText}
                    placeholder="Search by Roblox username…"
                    placeholderTextColor={C.muted}
                    style={[s.searchInput, { color: C.text }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                        if (!localState.isPro && searchText.trim()) {
                            InterstitialAdManager.showAd(() => searchSummaries(searchText));
                        } else {
                            searchSummaries(searchText);
                        }
                    }}
                />
                {searchText.length > 0 && (
                    <>
                        <TouchableOpacity onPress={() => {
                            if (!localState.isPro && searchText.trim()) {
                                InterstitialAdManager.showAd(() => searchSummaries(searchText));
                            } else {
                                searchSummaries(searchText);
                            }
                        }} style={{ padding: 4, marginRight: 4 }}>
                            <Icon name="search" size={18} color="#007AFF" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setSearchText(''); setIsSearchMode(false); fetchSummariesPage(true); }} style={{ padding: 4 }}>
                            <Icon name="close-circle" size={18} color={C.sub} />
                        </TouchableOpacity>
                    </>
                )}
            </View>

            {/* ── Filter Tabs ── */}
            <View style={s.filterRow}>
                {FILTERS.map((f) => (
                    <TouchableOpacity
                        key={f}
                        style={[s.filterTab, activeFilter === f && s.filterTabActive]}
                        onPress={() => onFilterChange(f)}
                        activeOpacity={0.7}
                    >
                        <Text style={[s.filterTabText, activeFilter === f && s.filterTabTextActive]}>{f}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* ── List ── */}
            <FlatList
                data={summaries}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                ListFooterComponent={ListFooter}
                contentContainerStyle={{ paddingBottom: 80 }}
                showsVerticalScrollIndicator={false}
                onEndReached={() => { if (!isSearchMode && hasMore && !loading) fetchSummariesPage(false); }}
                onEndReachedThreshold={0.3}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#007AFF" />
                }
            />

            {/* ── Report FAB ── */}
            <TouchableOpacity
                style={s.fab}
                onPress={() => {
                    if (!user?.id) { Alert.alert('Sign In Required', 'Please sign in to report a scammer.'); return; }
                    setShowReportModal(true);
                }}
                activeOpacity={0.8}
            >
                <Icon name="add" size={26} color="#FFF" />
            </TouchableOpacity>

            {/* ════════════════════════════════════════ */}
            {/*  DETAIL MODAL                           */}
            {/* ════════════════════════════════════════ */}
            <Modal visible={showDetailModal} animationType="slide" transparent>
                <View style={s.modalOverlay}>
                    <View style={[s.modalContent, { backgroundColor: C.card }]}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            {/* Close */}
                            <View style={s.modalHeader}>
                                <Text style={[s.modalTitle, { color: C.text }]}>Report Details</Text>
                                <TouchableOpacity onPress={() => setShowDetailModal(false)} style={{ padding: 4 }}>
                                    <Icon name="close" size={22} color={C.sub} />
                                </TouchableOpacity>
                            </View>

                            {/* Summary info */}
                            {selectedReport && (
                                <View style={{ marginBottom: 12 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                        <Icon name="person-circle" size={32} color={C.sub} style={{ marginRight: 10 }} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={[s.detailUsername, { color: C.text }]}>{selectedReport.reportedUsername}</Text>
                                            <Text style={[s.detailSub, { color: C.sub }]}>
                                                Scam date: {selectedReport.scamDate ? fmtDate(selectedReport.scamDate) : 'N/A'}
                                            </Text>
                                        </View>
                                        <View style={[s.badge, { backgroundColor: statusColor(selectedReport.status) + '20' }]}>
                                            <View style={[s.badgeDot, { backgroundColor: statusColor(selectedReport.status) }]} />
                                            <Text style={[s.badgeText, { color: statusColor(selectedReport.status) }]}>{statusLabel(selectedReport.status)}</Text>
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* Detail fields */}
                            {loadingDetail ? (
                                <ActivityIndicator size="small" color="#007AFF" style={{ padding: 20 }} />
                            ) : detailData ? (
                                <View>
                                    <View style={[s.detailField, { borderColor: C.border }]}>
                                        <Text style={[s.detailLabel, { color: C.sub }]}>Scam Type</Text>
                                        <Text style={[s.detailValue, { color: C.text }]}>{detailData.scamType || 'N/A'}</Text>
                                    </View>

                                    <View style={[s.detailField, { borderColor: C.border }]}>
                                        <Text style={[s.detailLabel, { color: C.sub }]}>What Happened</Text>
                                        <Text style={[s.detailValue, { color: C.text }]}>{detailData.whatHappened || 'N/A'}</Text>
                                    </View>

                                    {/* Proof images */}
                                    {detailData.proofUrls?.length > 0 && (
                                        <View style={{ marginTop: 8 }}>
                                            <Text style={[s.detailLabel, { color: C.sub, marginBottom: 6 }]}>Proof Screenshots</Text>
                                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                                {detailData.proofUrls.map((url, i) => (
                                                    <TouchableOpacity key={i} activeOpacity={0.8} onPress={() => setFullscreenImage(url)}>
                                                        <Image source={{ uri: url }} style={s.proofImage} resizeMode="cover" />
                                                    </TouchableOpacity>
                                                ))}
                                            </ScrollView>
                                        </View>
                                    )}

                                    {/* Mod/Admin actions */}
                                    {isMod && selectedReport && (
                                        <View style={s.modActions}>
                                            <Text style={[s.detailLabel, { color: C.sub, marginBottom: 8 }]}>Mod Actions</Text>
                                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                                <TouchableOpacity
                                                    style={[s.modBtn, { backgroundColor: '#34C759' }]}
                                                    onPress={() => approveReport(selectedReport.id)}
                                                    disabled={!!modAction}
                                                >
                                                    {modAction === 'approve' ? (
                                                        <ActivityIndicator size="small" color="#FFF" />
                                                    ) : (
                                                        <>
                                                            <Icon name="checkmark-circle" size={18} color="#FFF" style={{ marginRight: 6 }} />
                                                            <Text style={s.modBtnText}>Verify</Text>
                                                        </>
                                                    )}
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[s.modBtn, { backgroundColor: '#FF3B30' }]}
                                                    onPress={() => rejectReport(selectedReport.id)}
                                                    disabled={!!modAction}
                                                >
                                                    {modAction === 'reject' ? (
                                                        <ActivityIndicator size="small" color="#FFF" />
                                                    ) : (
                                                        <>
                                                            <Icon name="close-circle" size={18} color="#FFF" style={{ marginRight: 6 }} />
                                                            <Text style={s.modBtnText}>Delete</Text>
                                                        </>
                                                    )}
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    )}
                                </View>
                            ) : (
                                <Text style={[s.emptyText, { color: C.muted }]}>No details available.</Text>
                            )}
                        </ScrollView>

                        {/* Fullscreen image viewer — inside detail modal to avoid iOS z-order issues */}
                        {!!fullscreenImage && (
                            <View style={s.fullscreenOverlay}>
                                <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setFullscreenImage(null)} />
                                <TouchableOpacity style={s.fullscreenClose} onPress={() => setFullscreenImage(null)}>
                                    <Icon name="close-circle" size={32} color="#FFF" />
                                </TouchableOpacity>
                                <Image
                                    source={{ uri: fullscreenImage }}
                                    style={s.fullscreenImg}
                                    resizeMode="contain"
                                />
                            </View>
                        )}
                    </View>
                </View >
            </Modal >


            {/* ════════════════════════════════════════ */}
            {/*  REPORT FORM MODAL                      */}
            {/* ════════════════════════════════════════ */}
            <Modal visible={showReportModal} animationType="slide" transparent>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalOverlay}>
                    <View style={[s.modalContent, { backgroundColor: C.card, maxHeight: '90%' }]}>
                        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                            {/* Header */}
                            <View style={s.modalHeader}>
                                <Text style={[s.modalTitle, { color: C.text }]}>Report a Scammer</Text>
                                <TouchableOpacity onPress={() => setShowReportModal(false)} style={{ padding: 4 }}>
                                    <Icon name="close" size={22} color={C.sub} />
                                </TouchableOpacity>
                            </View>

                            {/* Safety note */}
                            <View style={[s.banner, { backgroundColor: C.bannerBg, marginBottom: 12 }]}>
                                <Text style={[s.bannerText, { color: C.bannerText, fontSize: 11 }]}>
                                    Only report genuine scammers. False reports may result in a ban.
                                </Text>
                            </View>

                            {/* Username */}
                            <Text style={[s.formLabel, { color: C.sub }]}>Roblox Username</Text>
                            <TextInput
                                value={reportUsername}
                                onChangeText={setReportUsername}
                                placeholder="Enter their Roblox username"
                                placeholderTextColor={C.muted}
                                style={[s.formInput, { backgroundColor: C.input, color: C.text, borderColor: C.border }]}
                                autoCapitalize="none"
                                autoCorrect={false}
                                maxLength={30}
                            />

                            {/* Scam Date */}
                            <Text style={[s.formLabel, { color: C.sub }]}>When did the scam happen?</Text>
                            <TextInput
                                value={reportScamDate}
                                onChangeText={setReportScamDate}
                                placeholder="e.g. Jan 5, 2025"
                                placeholderTextColor={C.muted}
                                style={[s.formInput, { backgroundColor: C.input, color: C.text, borderColor: C.border }]}
                                autoCapitalize="words"
                                maxLength={30}
                            />

                            {/* Scam Type */}
                            <Text style={[s.formLabel, { color: C.sub }]}>Scam Type</Text>
                            <View style={s.typeRow}>
                                {SCAM_TYPES.map((type) => (
                                    <TouchableOpacity
                                        key={type}
                                        onPress={() => setReportScamType(type)}
                                        style={[
                                            s.typeChip,
                                            {
                                                backgroundColor: reportScamType === type ? '#007AFF' : C.input,
                                                borderColor: reportScamType === type ? '#007AFF' : C.border,
                                            },
                                        ]}
                                    >
                                        <Text style={{ color: reportScamType === type ? '#FFF' : C.text, fontSize: 12, fontWeight: '600' }}>{type}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* What happened */}
                            <Text style={[s.formLabel, { color: C.sub }]}>What happened? <Text style={{ fontWeight: '400', fontSize: 10 }}>(max 200 chars)</Text></Text>
                            <TextInput
                                value={reportWhat}
                                onChangeText={(val) => setReportWhat(val.slice(0, 200))}
                                placeholder="Briefly describe what happened…"
                                placeholderTextColor={C.muted}
                                style={[s.formInput, s.formInputMulti, { backgroundColor: C.input, color: C.text, borderColor: C.border }]}
                                multiline
                                maxLength={200}
                            />
                            <Text style={{ color: C.muted, fontSize: 10, textAlign: 'right', marginTop: -4, marginBottom: 8 }}>{reportWhat.length}/200</Text>

                            {/* Proof images */}
                            <Text style={[s.formLabel, { color: C.sub }]}>Proof Screenshots <Text style={{ fontWeight: '400', fontSize: 10 }}>(optional, max 3)</Text></Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                                {reportImages.map((uri, i) => (
                                    <View key={i} style={{ position: 'relative' }}>
                                        <Image source={{ uri }} style={s.proofThumb} resizeMode="cover" />
                                        <TouchableOpacity
                                            onPress={() => setReportImages((prev) => prev.filter((_, idx) => idx !== i))}
                                            style={s.proofRemove}
                                        >
                                            <Icon name="close-circle" size={18} color="#FF3B30" />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                                {reportImages.length < 3 && (
                                    <TouchableOpacity onPress={handlePickProofImage} style={[s.addProofBtn, { borderColor: C.border }]}>
                                        <Icon name="camera-outline" size={22} color={C.sub} />
                                        <Text style={{ color: C.sub, fontSize: 10, marginTop: 2 }}>Add Photo</Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* Submit */}
                            <TouchableOpacity
                                style={[s.submitBtn, { opacity: submitting ? 0.6 : 1 }]}
                                onPress={submitReport}
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 8 }} />
                                        <Text style={s.submitBtnText}>{uploadingImages ? 'Uploading images…' : 'Submitting…'}</Text>
                                    </View>
                                ) : (
                                    <Text style={s.submitBtnText}>Submit Report</Text>
                                )}
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View >
    );
};

// ════════════════════════════════════════
//  STYLES
// ════════════════════════════════════════
const s = StyleSheet.create({
    container: { flex: 1 },

    // Banner
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        marginHorizontal: 10,
        marginTop: 6,
        marginBottom: 6,
    },
    bannerText: { fontSize: 12, flex: 1, fontWeight: '500', lineHeight: 16 },

    // Search
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 10,
        marginBottom: 8,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        height: 40,
    },
    searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },

    // Filter tabs
    filterRow: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 6, gap: 8 },
    filterTab: {
        paddingHorizontal: 14,
        paddingVertical: 3,
        borderRadius: 16,
        backgroundColor: '#E5E5EA',
    },
    filterTabActive: { backgroundColor: '#007AFF' },
    filterTabText: { fontSize: 10, fontWeight: '600', color: '#666' },
    filterTabTextActive: { color: '#FFF' },


    // List
    listItem: {
        marginHorizontal: 10,
        marginBottom: 6,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    listLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
    listUsername: { fontSize: 15, fontWeight: '700' },
    listDate: { fontSize: 11, marginTop: 2 },

    // Badge
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 20,
    },
    badgeDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
    badgeText: { fontSize: 10, fontWeight: '700' },

    // Load more
    loadMoreBtn: { alignItems: 'center', paddingVertical: 12 },
    loadMoreText: { color: '#007AFF', fontSize: 14, fontWeight: '600' },
    emptyText: { textAlign: 'center', paddingVertical: 40, fontSize: 14 },

    // FAB
    fab: {
        position: 'absolute',
        bottom: 24,
        right: 20,
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: '#FF3B30',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
    },

    // Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        maxHeight: '85%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    modalTitle: { fontSize: 18, fontWeight: '700' },

    // Detail
    detailUsername: { fontSize: 18, fontWeight: '700' },
    detailSub: { fontSize: 12, marginTop: 2 },
    detailField: { borderBottomWidth: 1, paddingVertical: 10 },
    detailLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
    detailValue: { fontSize: 14, lineHeight: 20 },
    proofImage: { width: 140, height: 100, borderRadius: 10, marginRight: 8, backgroundColor: '#DDD' },

    // Fullscreen image viewer
    fullscreenOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 },
    fullscreenClose: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 20, right: 20, zIndex: 10 },
    fullscreenImg: { width: Dimensions.get('window').width, height: Dimensions.get('window').height * 0.8 },

    // Mod
    modActions: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E5EA' },
    modBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 10,
    },
    modBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },

    // Form
    formLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, marginTop: 6 },
    formInput: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        marginBottom: 8,
    },
    formInputMulti: { minHeight: 70, textAlignVertical: 'top' },
    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    typeChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
    },
    proofThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#DDD' },
    proofRemove: { position: 'absolute', top: -6, right: -6 },
    addProofBtn: {
        width: 64,
        height: 64,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitBtn: {
        backgroundColor: '#FF3B30',
        paddingVertical: 14,
        borderRadius: 14,
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 8,
    },
    submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

export default React.memo(ScammerDatabaseScreen);
