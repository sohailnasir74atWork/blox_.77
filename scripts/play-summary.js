#!/usr/bin/env node
// Aggregate the latest analytics CSVs by versionCode and print a per-version
// summary. Run after play-fetch.js.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'analytics', new Date().toISOString().slice(0, 10));

function readCsv(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8').trim();
  const [header, ...rows] = text.split('\n');
  const cols = header.split(',');
  return rows.map((r) => {
    const v = r.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
}

function avgByVersion(rows, metric, weightCol = 'distinctUsers', filter = () => true) {
  const acc = new Map();
  for (const r of rows) {
    if (!filter(r)) continue;
    const v = r.versionCode;
    const m = parseFloat(r[metric]);
    const w = parseFloat(r[weightCol]) || 0;
    if (!Number.isFinite(m) || w === 0) continue;
    const cur = acc.get(v) || { sum: 0, w: 0 };
    cur.sum += m * w;
    cur.w += w;
    acc.set(v, cur);
  }
  return Array.from(acc, ([v, { sum, w }]) => ({ versionCode: parseInt(v, 10), value: sum / w, users: w }))
    .sort((a, b) => a.versionCode - b.versionCode);
}

// Optional: map versionCode → human-readable versionName for the summary
// table. Fill in as needed. The summary still works with an empty map —
// the versionName column just stays blank.
const versionName = {
  // 1: '0.0.1',  // example
};

function table(rows, valueLabel, fmt = (x) => (x * 100).toFixed(2) + '%') {
  console.log(`\n  versionCode  versionName  ${valueLabel.padEnd(12)} userDays`);
  console.log(`  -----------  -----------  ------------ --------`);
  for (const r of rows) {
    const v = String(r.versionCode).padStart(11);
    const n = (versionName[r.versionCode] || '').padEnd(11);
    const val = fmt(r.value).padStart(12);
    const u = String(Math.round(r.users)).padStart(8);
    console.log(`  ${v}  ${n}  ${val} ${u}`);
  }
}

console.log('=== Per-version vitals (28 days, weighted by user-days) ===');

const crash = readCsv('crash_rate.csv');
table(avgByVersion(crash, 'crashRate'), 'crashRate');

const anr = readCsv('anr_rate.csv');
table(avgByVersion(anr, 'userPerceivedAnrRate'), 'anrRate(UP)');

const slow = readCsv('slow_start_rate.csv');
console.log('\n--- Slow start: COLD ---');
table(avgByVersion(slow, 'slowStartRate', 'distinctUsers', (r) => r.startType === 'COLD'), 'slowStart');

console.log('\n--- Slow start: WARM ---');
table(avgByVersion(slow, 'slowStartRate', 'distinctUsers', (r) => r.startType === 'WARM'), 'slowStart');

const wake = readCsv('excessive_wakeup_rate.csv');
table(avgByVersion(wake, 'excessiveWakeupRate'), 'wakeupRate');

console.log('\n=== Recent reviews ===');
const reviews = readCsv('reviews.csv');
const byVer = new Map();
const byStar = [0, 0, 0, 0, 0, 0];
for (const r of reviews) {
  byStar[parseInt(r.starRating, 10) || 0]++;
  const v = r.appVersion || '?';
  byVer.set(v, (byVer.get(v) || 0) + 1);
}
console.log(`  Stars: 1★=${byStar[1]} 2★=${byStar[2]} 3★=${byStar[3]} 4★=${byStar[4]} 5★=${byStar[5]}`);
console.log(`  By version: ${[...byVer].map(([v, n]) => `${v}=${n}`).join(', ')}`);
console.log('\n  Worst (1-2★) review excerpts:');
reviews
  .filter((r) => parseInt(r.starRating, 10) <= 2)
  .slice(0, 5)
  .forEach((r) => console.log(`    [${r.starRating}★ v${r.appVersion}] ${(r.text || '').slice(0, 140)}`));
