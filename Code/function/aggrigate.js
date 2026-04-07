const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const firestore = admin.firestore();
const rtdb = admin.database();

/**
 * aggregateTradeAnalytics — Blox Fruit Edition
 *
 * SCHEDULED Cloud Function — runs every 12 hours.
 * Reads trades from Firestore (trades_new_upgrade collection).
 * Writes aggregated analytics to RTDB at /analytics.
 *
 * After this runs, push the RTDB data to Bunny CDN.
 * The app reads from Bunny CDN (zero Firebase reads from users).
 *
 * Blox Fruit trade item structure: { name, type ('n'/'p'), value }
 * Image URLs generated from name: /2024/09/{name}_Icon.webp (normal) or /2024/08/ (permanent)
 *
 * Deployment:
 * firebase deploy --only functions:aggregateTradeAnalytics
 */

// ── Helper: fetch all docs from a query using pagination ──
const fetchAllDocs = async (query, batchSize = 500) => {
  const allDocs = [];
  let lastDoc = null;

  while (true) {
    let q = query.limit(batchSize);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    snap.docs.forEach(d => allDocs.push(d));
    lastDoc = snap.docs[snap.docs.length - 1];

    if (snap.docs.length < batchSize) break;
  }

  return allDocs;
};

// ── Helper: generate image URL from fruit name and type ──
const getFruitImageUrl = (name, type) => {
  if (!name) return '';
  const formatted = name.replace(/^\+/, '').replace(/\s+/g, '-');
  const month = type === 'p' ? '08' : '09';
  return 'https://bloxfruitscalc.com/wp-content/uploads/2024/' + month + '/' + formatted + '_Icon.webp';
};

// ── Scheduled function: runs every 12 hours ──
exports.aggregateTradeAnalytics = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub.schedule('every 12 hours')
  .onRun(async (context) => {
    try {
      const now = Date.now();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // ── Fetch ALL trades from last 7 days (paginated) ──
      const weekTradeDocs = await fetchAllDocs(
        firestore.collection('trades_new_upgrade')
          .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(oneWeekAgo))
          .orderBy('timestamp', 'desc')
      );

      const weekTrades = weekTradeDocs.map(d => ({ id: d.id, ...d.data() }));
      console.log('Fetched ' + weekTrades.length + ' trades from last 7 days');

      // ── Helper: extract timestamp safely ──
      const getTs = (t) => t.timestamp && t.timestamp.toDate ? t.timestamp.toDate() : new Date(t.timestamp);

      // ── Separate time windows ──
      const todayTrades = weekTrades.filter(t => getTs(t) >= todayStart);
      const last24hTrades = weekTrades.filter(t => getTs(t) >= oneDayAgo);

      const midWeek = new Date(now - 3.5 * 24 * 60 * 60 * 1000);
      const firstHalfTrades = weekTrades.filter(t => getTs(t) < midWeek);
      const secondHalfTrades = weekTrades.filter(t => getTs(t) >= midWeek);

      // ── Count item appearances ──
      // Blox Fruit items: { name, type ('n'/'p'), value }
      const countItems = (trades, side) => {
        const counts = {};
        trades.forEach(trade => {
          const items = side === 'has' ? (trade.hasItems || []) :
                        side === 'wants' ? (trade.wantsItems || []) :
                        [...(trade.hasItems || []), ...(trade.wantsItems || [])];
          items.forEach(item => {
            if (!item || !item.name) return;
            const key = item.name.toLowerCase().trim() + '_' + (item.type || 'n');
            if (!counts[key]) {
              counts[key] = {
                name: item.name,
                type: item.type || 'n',
                image: getFruitImageUrl(item.name, item.type),
                value: Number(item.value) || 0,
                count: 0,
              };
            }
            counts[key].count++;
            const numVal = Number(item.value) || 0;
            if (numVal > counts[key].value) {
              counts[key].value = numVal;
            }
          });
        });
        return counts;
      };

      // ── Most traded fruits (both sides combined, 24h) ──
      const allItemCounts = countItems(last24hTrades, 'all');
      const topTraded = Object.values(allItemCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // ── Most wanted (demand from trade wants) ──
      const wantsCounts24h = countItems(last24hTrades, 'wants');
      const topWanted = Object.values(wantsCounts24h)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // ── Most offered (supply from trade has) ──
      const hasCounts24h = countItems(last24hTrades, 'has');
      const topOffered = Object.values(hasCounts24h)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // ── Demand/Supply ratio ──
      const totalActivity24h = last24hTrades.length || 1;
      const minDSTotal = Math.max(5, Math.round(totalActivity24h * 0.005));

      const allItemNames = new Set([
        ...Object.keys(wantsCounts24h),
        ...Object.keys(hasCounts24h),
      ]);

      const demandSupplyRatios = [];
      allItemNames.forEach(key => {
        const demand = wantsCounts24h[key] ? wantsCounts24h[key].count : 0;
        const supply = hasCounts24h[key] ? hasCounts24h[key].count : 0;
        const total = demand + supply;
        if (total < minDSTotal) return;

        const ratio = supply > 0 ? demand / supply : demand > 0 ? Math.min(demand, 10) : 0;
        const volumeShare = ((total / totalActivity24h) * 100);
        demandSupplyRatios.push({
          name: (wantsCounts24h[key] && wantsCounts24h[key].name) || (hasCounts24h[key] && hasCounts24h[key].name) || key,
          type: (wantsCounts24h[key] && wantsCounts24h[key].type) || (hasCounts24h[key] && hasCounts24h[key].type) || 'n',
          image: (wantsCounts24h[key] && wantsCounts24h[key].image) || (hasCounts24h[key] && hasCounts24h[key].image) || '',
          value: (wantsCounts24h[key] && wantsCounts24h[key].value) || (hasCounts24h[key] && hasCounts24h[key].value) || 0,
          demand: demand,
          supply: supply,
          ratio: Math.round(ratio * 100) / 100,
          total: total,
          volumeShare: Math.round(volumeShare * 10) / 10,
          signal: ratio > 2.0 ? 'rising' : ratio < 0.5 ? 'falling' : 'stable',
        });
      });

      demandSupplyRatios.sort((a, b) => {
        const scoreA = a.ratio * Math.log2(a.total + 1);
        const scoreB = b.ratio * Math.log2(b.total + 1);
        return scoreB - scoreA;
      });

      // ── Trend detection: first half vs second half of week ──
      const firstHalfWants = countItems(firstHalfTrades, 'wants');
      const secondHalfWants = countItems(secondHalfTrades, 'wants');
      const totalWeekActivity = weekTrades.length || 1;
      const minTrendTotal = Math.max(3, Math.round(totalWeekActivity * 0.002));

      const trendItems = [];
      const allTrendKeys = new Set([
        ...Object.keys(firstHalfWants),
        ...Object.keys(secondHalfWants),
      ]);

      allTrendKeys.forEach(key => {
        const before = firstHalfWants[key] ? firstHalfWants[key].count : 0;
        const after = secondHalfWants[key] ? secondHalfWants[key].count : 0;
        const total = before + after;
        if (total < minTrendTotal) return;
        if (before === 0 && after < 3) return;
        if (after === 0 && before < 3) return;

        var change;
        if (before === 0) {
          change = Math.min(100, after * 20);
        } else if (after === 0) {
          change = Math.max(-100, -before * 20);
        } else {
          change = ((after - before) / before) * 100;
        }
        change = Math.max(-500, Math.min(500, change));

        const volumeChange = Math.abs(after - before);

        trendItems.push({
          name: (secondHalfWants[key] && secondHalfWants[key].name) || (firstHalfWants[key] && firstHalfWants[key].name) || key,
          type: (secondHalfWants[key] && secondHalfWants[key].type) || (firstHalfWants[key] && firstHalfWants[key].type) || 'n',
          image: (secondHalfWants[key] && secondHalfWants[key].image) || (firstHalfWants[key] && firstHalfWants[key].image) || '',
          value: (secondHalfWants[key] && secondHalfWants[key].value) || (firstHalfWants[key] && firstHalfWants[key].value) || 0,
          before: before,
          after: after,
          changePercent: Math.round(change),
          volumeChange: volumeChange,
          direction: change > 25 ? 'up' : change < -25 ? 'down' : 'stable',
        });
      });

      const topMovers = trendItems
        .filter(function(i) { return i.direction === 'up'; })
        .sort(function(a, b) {
          var scoreA = a.volumeChange * Math.log2(Math.abs(a.changePercent) + 1);
          var scoreB = b.volumeChange * Math.log2(Math.abs(b.changePercent) + 1);
          return scoreB - scoreA;
        })
        .slice(0, 10);

      const topLosers = trendItems
        .filter(function(i) { return i.direction === 'down'; })
        .sort(function(a, b) {
          var scoreA = a.volumeChange * Math.log2(Math.abs(a.changePercent) + 1);
          var scoreB = b.volumeChange * Math.log2(Math.abs(b.changePercent) + 1);
          return scoreB - scoreA;
        })
        .slice(0, 10);

      // ── Trade volume stats ──
      const tradeVolume = {
        today: todayTrades.length,
        last24h: last24hTrades.length,
        thisWeek: weekTrades.length,
      };

      // ── Win/Lose/Fair distribution (24h) ──
      const statusDistribution = {
        win: last24hTrades.filter(function(t) { return t.status === 'w'; }).length,
        lose: last24hTrades.filter(function(t) { return t.status === 'l'; }).length,
        fair: last24hTrades.filter(function(t) { return t.status === 'f'; }).length,
      };

      // ── Hourly trade activity (24h) ──
      const hourlyActivity = new Array(24).fill(0);
      last24hTrades.forEach(function(trade) {
        var hour = getTs(trade).getHours();
        hourlyActivity[hour]++;
      });

      const peakHour = hourlyActivity.indexOf(Math.max.apply(null, hourlyActivity));

      // ── Predictions (demand/supply based) ──
      const minPredTotal = Math.max(10, Math.round(totalActivity24h * 0.005));

      const predictions = demandSupplyRatios
        .filter(function(item) { return item.total >= minPredTotal; })
        .map(function(item) {
          var volWeight = Math.min(1, item.volumeShare / 2);
          var effectiveRatio = item.ratio * (0.5 + volWeight * 0.5);

          var prediction = effectiveRatio > 3.0 ? 'strong_rise' :
                          effectiveRatio > 1.8 ? 'likely_rise' :
                          effectiveRatio > 0.8 ? 'stable' :
                          effectiveRatio > 0.4 ? 'likely_fall' : 'strong_fall';

          var confidence = Math.min(95, Math.round(
            Math.min(item.volumeShare * 15, 60) +
            Math.min(item.total / 5, 35)
          ));

          return Object.assign({}, item, {
            prediction: prediction,
            confidence: confidence,
          });
        })
        .sort(function(a, b) {
          return (b.confidence * b.ratio) - (a.confidence * a.ratio);
        })
        .slice(0, 20);

      // ── Most valuable fruits in trades (by total value moved) ──
      const valueMoved = {};
      last24hTrades.forEach(function(trade) {
        var allItems = [].concat(trade.hasItems || [], trade.wantsItems || []);
        allItems.forEach(function(item) {
          if (!item || !item.name) return;
          var key = item.name.toLowerCase().trim() + '_' + (item.type || 'n');
          if (!valueMoved[key]) {
            valueMoved[key] = {
              name: item.name,
              type: item.type || 'n',
              image: getFruitImageUrl(item.name, item.type),
              totalValue: 0,
              count: 0,
            };
          }
          valueMoved[key].totalValue += (Number(item.value) || 0);
          valueMoved[key].count++;
        });
      });
      const topByValue = Object.values(valueMoved)
        .sort(function(a, b) { return b.totalValue - a.totalValue; })
        .slice(0, 20);

      // ── Store in RTDB ──
      const analyticsData = {
        topTraded: topTraded,
        topWanted: topWanted,
        topOffered: topOffered,
        topByValue: topByValue,
        topMovers: topMovers,
        topLosers: topLosers,
        demandSupplyRatios: demandSupplyRatios.slice(0, 30),
        predictions: predictions,
        tradeVolume: tradeVolume,
        statusDistribution: statusDistribution,
        hourlyActivity: hourlyActivity,
        peakHour: peakHour,
        updatedAt: admin.database.ServerValue.TIMESTAMP,
        computedAt: new Date().toISOString(),
      };

      await rtdb.ref('analytics').set(analyticsData);

      console.log('Analytics done: ' + weekTrades.length + ' week trades, ' + last24hTrades.length + ' 24h trades, ' + topTraded.length + ' top items');
      return null;
    } catch (error) {
      console.error('Error aggregating trade analytics:', error);
      return null;
    }
  });
