const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// Keep the Cloud Functions codebase (functions/ + its own node_modules) and the
// audit docs out of Metro's crawl. Nothing in the app imports them, so the JS
// bundle is unchanged — this only guarantees the AAB/IPA can never grow because
// server-side code lives in this repo.
const config = {
  resolver: {
    blockList: new RegExp(`^${escapeRe(path.resolve(__dirname))}/(functions|docs)/.*`),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
