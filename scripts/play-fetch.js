#!/usr/bin/env node
// Pull vitals + reviews from Play Console for the Blox Fruit app.
// Writes CSVs to ../analytics/<date>/.
//
// Usage:
//   node scripts/play-fetch.js                              # default: com.bloxfruitevalues
//   PLAY_PACKAGE=com.bloxfruitstock node scripts/play-fetch.js  # other variant
//
// SETUP (one-time, otherwise expect 403/404 from Play APIs):
//   1. Play Console → Users and permissions → Invite new users
//      Email: quality-test@quality-blox.iam.gserviceaccount.com
//      (this SA lives in .secrets/play-sa-key.json)
//   2. Grant app permissions for Blox Fruit Values Calculator:
//        - View app information and download bulk reports
//        - View financial data
//        - Reply to reviews
//   3. Enable APIs in the quality-blox GCP project:
//        - Google Play Android Developer API
//        - Play Developer Reporting API
//   4. (Optional, for installs CSV) Grant SA "Storage Object Viewer" on
//      the pubsite_prod_<dev-id> bucket — see Play Console → Download
//      reports → copy Cloud Storage URI.

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const PACKAGE = process.env.PLAY_PACKAGE || 'com.bloxfruitevalues';
const KEY_FILE = path.join(__dirname, '..', '.secrets', 'play-sa-key.json');
const OUT_DIR = path.join(__dirname, '..', 'analytics', new Date().toISOString().slice(0, 10));

const REPORTING = 'https://playdeveloperreporting.googleapis.com/v1beta1';
const PUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/playdeveloperreporting',
  'https://www.googleapis.com/auth/androidpublisher',
  'https://www.googleapis.com/auth/devstorage.read_only',
];

const auth = new GoogleAuth({ keyFile: KEY_FILE, scopes: SCOPES });

async function token() {
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  return t.token;
}

async function call(url, body) {
  const t = await token();
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\nURL: ${url}\nBODY: ${text.slice(0, 1000)}`);
  }
  return JSON.parse(text);
}

// Each metric set has its own data-freshness lag. The GET on the metric set
// resource returns a freshnessInfo block — use that to pick a valid endTime.
async function getFreshness(name) {
  const resp = await call(`${REPORTING}/apps/${PACKAGE}/${name}`);
  const daily = (resp.freshnessInfo?.freshnesses || []).find((f) => f.aggregationPeriod === 'DAILY');
  return daily?.latestEndTime || null;
}

function dailyTimeline(latestEnd, days = 28) {
  const end = new Date(Date.UTC(latestEnd.year, latestEnd.month - 1, latestEnd.day));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    aggregationPeriod: 'DAILY',
    startTime: { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1, day: start.getUTCDate(), timeZone: { id: 'America/Los_Angeles' } },
    endTime:   { year: latestEnd.year, month: latestEnd.month, day: latestEnd.day, timeZone: { id: 'America/Los_Angeles' } },
  };
}

async function queryMetricSet(name, metrics, dimensions = ['versionCode']) {
  const latest = await getFreshness(name);
  if (!latest) throw new Error(`No DAILY freshness for ${name}`);
  return call(`${REPORTING}/apps/${PACKAGE}/${name}:query`, {
    timelineSpec: dailyTimeline(latest, 28),
    dimensions,
    metrics,
  });
}

function rowsToCsv(rows) {
  if (!rows || rows.length === 0) return 'no rows\n';
  const headers = Array.from(
    rows.reduce((s, r) => {
      Object.keys(r).forEach((k) => s.add(k));
      return s;
    }, new Set())
  );
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const v = r[h];
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

function flattenMetricRows(resp) {
  // Reporting API rows: { startTime, endTime, dimensions: [{dimension, valueLabel|stringValue|int64Value}], metrics: [{metric, decimalValue:{value}|...}]}
  const out = [];
  for (const r of resp.rows || []) {
    const row = {};
    if (r.startTime) row.date = `${r.startTime.year}-${String(r.startTime.month).padStart(2, '0')}-${String(r.startTime.day).padStart(2, '0')}`;
    for (const d of r.dimensions || []) {
      row[d.dimension] = d.valueLabel || d.stringValue || d.int64Value || '';
    }
    for (const m of r.metrics || []) {
      const v = m.decimalValue?.value ?? m.int64Value ?? m.poissonConfidenceInterval?.lowerBound?.value ?? '';
      row[m.metric] = v;
    }
    out.push(row);
  }
  return out;
}

async function fetchVitals() {
  const targets = [
    { file: 'crash_rate.csv',            name: 'crashRateMetricSet',          metrics: ['crashRate', 'crashRate7dUserWeighted', 'distinctUsers'], dims: ['versionCode'] },
    { file: 'anr_rate.csv',              name: 'anrRateMetricSet',            metrics: ['anrRate', 'userPerceivedAnrRate', 'distinctUsers'],     dims: ['versionCode'] },
    { file: 'slow_start_rate.csv',       name: 'slowStartRateMetricSet',      metrics: ['slowStartRate', 'distinctUsers'],                       dims: ['versionCode', 'startType'] },
    { file: 'excessive_wakeup_rate.csv', name: 'excessiveWakeupRateMetricSet', metrics: ['excessiveWakeupRate', 'distinctUsers'],                 dims: ['versionCode'] },
    { file: 'crash_by_country.csv',      name: 'crashRateMetricSet',          metrics: ['crashRate', 'distinctUsers'],                            dims: ['countryCode'] },
    { file: 'crash_by_api.csv',          name: 'crashRateMetricSet',          metrics: ['crashRate', 'distinctUsers'],                            dims: ['apiLevel'] },
    { file: 'crash_by_device.csv',       name: 'crashRateMetricSet',          metrics: ['crashRate', 'distinctUsers'],                            dims: ['deviceModel', 'deviceBrand'] },
    { file: 'slow_start_by_ram.csv',     name: 'slowStartRateMetricSet',      metrics: ['slowStartRate', 'distinctUsers'],                        dims: ['startType', 'deviceRamBucket'] },
    { file: 'slow_start_by_country.csv', name: 'slowStartRateMetricSet',      metrics: ['slowStartRate', 'distinctUsers'],                        dims: ['startType', 'countryCode'] },
    { file: 'error_count_by_version.csv', name: 'errorCountMetricSet',        metrics: ['errorReportCount', 'distinctUsers'],                     dims: ['versionCode', 'reportType'] },
  ];
  const results = {};
  for (const t of targets) {
    try {
      const resp = await queryMetricSet(t.name, t.metrics, t.dims);
      const rows = flattenMetricRows(resp);
      fs.writeFileSync(path.join(OUT_DIR, t.file), rowsToCsv(rows));
      results[t.name] = { ok: true, rows: rows.length };
    } catch (e) {
      results[t.name] = { ok: false, error: e.message.split('\n')[0] };
    }
  }
  return results;
}

async function fetchReviews() {
  // androidpublisher reviews API — paginated (Play caps at ~7 days history regardless)
  try {
    const all = [];
    let nextToken;
    for (let page = 0; page < 20; page++) {
      const url = `${PUBLISHER}/applications/${PACKAGE}/reviews?maxResults=100${nextToken ? `&token=${nextToken}` : ''}`;
      const resp = await call(url);
      const rows = (resp.reviews || []).map((r) => {
        const c = r.comments?.[0]?.userComment;
        return {
          reviewId: r.reviewId,
          author: r.authorName,
          starRating: c?.starRating,
          date: c?.lastModified ? new Date(parseInt(c.lastModified.seconds, 10) * 1000).toISOString().slice(0, 10) : '',
          appVersion: c?.appVersionName || c?.appVersionCode,
          device: c?.deviceMetadata?.productName,
          androidOs: c?.androidOsVersion,
          text: (c?.text || '').replace(/\s+/g, ' ').trim(),
        };
      });
      all.push(...rows);
      nextToken = resp.tokenPagination?.nextPageToken;
      if (!nextToken || rows.length === 0) break;
    }
    fs.writeFileSync(path.join(OUT_DIR, 'reviews.csv'), rowsToCsv(all));
    return { ok: true, rows: all.length };
  } catch (e) {
    return { ok: false, error: e.message.split('\n')[0] };
  }
}

// Top crash/ANR issues with stack frame + sample report id
async function fetchErrorIssues() {
  try {
    const all = [];
    let nextToken;
    const latest = await getFreshness('errorCountMetricSet').catch(() => null);
    if (!latest) throw new Error('No freshness for errorCountMetricSet');
    const intervalEnd = new Date(Date.UTC(latest.year, latest.month - 1, latest.day));
    const intervalStart = new Date(intervalEnd);
    intervalStart.setUTCDate(intervalStart.getUTCDate() - 27);
    // errorIssues:search uses naive DateTime (no timezone, no utcOffset)
    const intervalQs = [
      `interval.startTime.year=${intervalStart.getUTCFullYear()}`,
      `interval.startTime.month=${intervalStart.getUTCMonth() + 1}`,
      `interval.startTime.day=${intervalStart.getUTCDate()}`,
      `interval.startTime.hours=0`,
      `interval.endTime.year=${latest.year}`,
      `interval.endTime.month=${latest.month}`,
      `interval.endTime.day=${latest.day}`,
      `interval.endTime.hours=0`,
    ].join('&');
    for (let page = 0; page < 5; page++) {
      const url = `${REPORTING}/apps/${PACKAGE}/errorIssues:search?${intervalQs}&pageSize=50&orderBy=${encodeURIComponent('errorReportCount desc')}${nextToken ? `&pageToken=${encodeURIComponent(nextToken)}` : ''}`;
      const resp = await call(url);
      for (const i of resp.errorIssues || []) {
        all.push({
          name: i.name,
          type: i.type,
          cause: (i.cause || '').replace(/\s+/g, ' ').slice(0, 300),
          location: (i.location || '').replace(/\s+/g, ' ').slice(0, 300),
          errorReportCount: i.errorReportCount,
          distinctUsers: i.distinctUsers,
          firstAppVersion: i.firstAppVersion?.versionCode,
          lastAppVersion: i.lastAppVersion?.versionCode,
          firstOsVersion: i.firstOsVersion?.apiLevel,
          lastOsVersion: i.lastOsVersion?.apiLevel,
          firstSeen: i.firstOccurrenceTime,
          lastSeen: i.lastOccurrenceTime,
          sampleReportId: i.sampleErrorReports?.[0]?.split('/').pop(),
        });
      }
      nextToken = resp.nextPageToken;
      if (!nextToken) break;
    }
    fs.writeFileSync(path.join(OUT_DIR, 'error_issues.csv'), rowsToCsv(all));
    return { ok: true, rows: all.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Anomalies — Play's auto-flagged regressions vs prior baseline
async function fetchAnomalies() {
  try {
    const url = `${REPORTING}/apps/${PACKAGE}/anomalies?pageSize=50`;
    const resp = await call(url);
    const rows = (resp.anomalies || []).map((a) => ({
      name: a.name,
      metricSet: a.metricSet,
      metricValue: a.metric?.metric,
      timelineStart: a.timelineSpec?.startTime ? `${a.timelineSpec.startTime.year}-${a.timelineSpec.startTime.month}-${a.timelineSpec.startTime.day}` : '',
      timelineEnd: a.timelineSpec?.endTime ? `${a.timelineSpec.endTime.year}-${a.timelineSpec.endTime.month}-${a.timelineSpec.endTime.day}` : '',
      dimensions: JSON.stringify(a.dimensions || []).slice(0, 300),
    }));
    fs.writeFileSync(path.join(OUT_DIR, 'anomalies.csv'), rowsToCsv(rows));
    return { ok: true, rows: rows.length };
  } catch (e) {
    return { ok: false, error: e.message.split('\n')[0] };
  }
}

// Cloud Storage daily reports (the only source of installs/uninstalls by country/version).
// Bucket name comes from Play Console → Download reports → Statistics → "Copy Cloud Storage URI"
// Pattern: pubsite_prod_<developer-id>. We discover it by listing buckets the SA can see.
async function fetchInstallReports() {
  try {
    const t = await token();
    // List buckets the SA can read
    const listRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).project_id)}&prefix=pubsite_prod_`,
      { headers: { Authorization: `Bearer ${t}` } }
    );
    let bucketName;
    if (listRes.ok) {
      const data = await listRes.json();
      bucketName = data.items?.[0]?.name;
    }
    // Fallback: try listing all the SA can see (works when project filter doesn't match)
    if (!bucketName) {
      // Common pattern — the Play Console reports bucket is owned by Google's project,
      // not yours. The SA must be granted Storage Object Viewer on the bucket directly.
      // We'll let the user paste the URI later if needed.
      throw new Error('No pubsite_prod_* bucket visible to SA — needs Storage Object Viewer on the reports bucket');
    }
    // List the installs report objects (CSV-zipped, one per month)
    const objRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucketName}/o?prefix=stats/installs/&maxResults=50`,
      { headers: { Authorization: `Bearer ${t}` } }
    );
    if (!objRes.ok) throw new Error(`Listing installs: HTTP ${objRes.status}`);
    const objs = (await objRes.json()).items || [];
    // Download the most recent month's overview file
    const sorted = objs.filter((o) => /overview\.csv$/.test(o.name)).sort((a, b) => b.name.localeCompare(a.name));
    if (sorted.length === 0) throw new Error('No installs overview CSV found');
    const target = sorted[0];
    const dl = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(target.name)}?alt=media`,
      { headers: { Authorization: `Bearer ${t}` } }
    );
    if (!dl.ok) throw new Error(`Download: HTTP ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    // Reports are UTF-16 LE — convert to utf8 for sanity
    const text = buf.toString('utf16le').replace(/^﻿/, '');
    fs.writeFileSync(path.join(OUT_DIR, `installs_${path.basename(target.name)}`), text);
    return { ok: true, rows: text.split('\n').length - 1, bucket: bucketName, file: target.name };
  } catch (e) {
    return { ok: false, error: e.message.split('\n')[0] };
  }
}

(async () => {
  if (!fs.existsSync(KEY_FILE)) {
    console.error(`Service account key missing: ${KEY_FILE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Fetching Play data for ${PACKAGE}`);
  console.log(`Output: ${OUT_DIR}\n`);

  console.log('Vitals:');
  const v = await fetchVitals();
  for (const [name, r] of Object.entries(v)) {
    console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${name}: ${r.ok ? `${r.rows} rows` : r.error}`);
  }

  console.log('\nReviews:');
  const rv = await fetchReviews();
  console.log(`  ${rv.ok ? 'OK ' : 'ERR'} reviews: ${rv.ok ? `${rv.rows} rows` : rv.error}`);

  console.log('\nError issues (top crashes/ANRs):');
  const ei = await fetchErrorIssues();
  console.log(`  ${ei.ok ? 'OK ' : 'ERR'} error_issues: ${ei.ok ? `${ei.rows} rows` : ei.error}`);

  console.log('\nAnomalies (Play auto-flagged regressions):');
  const an = await fetchAnomalies();
  console.log(`  ${an.ok ? 'OK ' : 'ERR'} anomalies: ${an.ok ? `${an.rows} rows` : an.error}`);

  console.log('\nInstall reports (Cloud Storage):');
  const ir = await fetchInstallReports();
  console.log(`  ${ir.ok ? 'OK ' : 'ERR'} installs: ${ir.ok ? `${ir.rows} rows from ${ir.file}` : ir.error}`);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
