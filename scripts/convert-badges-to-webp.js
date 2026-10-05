#!/usr/bin/env node
// One-time: convert source badge PNGs to WebP. Source lives in
// Code/Assets/badges/ (imported via require() in badgeUtils.js). Metro copies
// these into drawable-mdpi at build time — converting source means the build
// output also becomes WebP, shipping smaller in the AAB.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC_DIR = path.join(__dirname, '..', 'Code/Assets/badges');
const BADGE_UTILS = path.join(__dirname, '..', 'Code/ChatScreen/GroupChat/badgeUtils.js');

(async () => {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.png'));
  if (files.length === 0) {
    console.log('No PNG badges found in source folder.');
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;
  console.log(`Converting ${files.length} source badges...\n`);

  for (const f of files) {
    const src = path.join(SRC_DIR, f);
    const dst = path.join(SRC_DIR, f.replace(/\.png$/, '.webp'));
    const before = fs.statSync(src).size;
    totalBefore += before;

    await sharp(src).webp({ quality: 80, effort: 6 }).toFile(dst);
    const after = fs.statSync(dst).size;
    totalAfter += after;

    console.log(
      `  ${f.padEnd(36)} ${(before / 1024).toFixed(1).padStart(6)} KB → ${(after / 1024).toFixed(1).padStart(6)} KB  (${Math.round((1 - after / before) * 100)}% off)`
    );

    fs.unlinkSync(src);
  }

  console.log(`\nSource:  ${(totalBefore / 1024).toFixed(0)} KB → ${(totalAfter / 1024).toFixed(0)} KB`);
  console.log(`Saved:   ${((totalBefore - totalAfter) / 1024).toFixed(0)} KB (${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);

  // Update badgeUtils.js: rewrite require('.../badge_X.png') → require('.../badge_X.webp')
  let utils = fs.readFileSync(BADGE_UTILS, 'utf8');
  const before = utils;
  utils = utils.replace(
    /(require\(['"][^'"]*\/Assets\/badges\/badge_[A-Za-z]+)\.png(['"]\))/g,
    '$1.webp$2',
  );
  if (utils !== before) {
    fs.writeFileSync(BADGE_UTILS, utils);
    const replaced = (before.match(/badge_[A-Za-z]+\.png/g) || []).length;
    console.log(`\nUpdated ${BADGE_UTILS}: ${replaced} require() calls .png → .webp`);
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
