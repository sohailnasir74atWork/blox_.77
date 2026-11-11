module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    // Release bundles only (Metro sets BABEL_ENV=production when dev is
    // false; Gradle and Xcode bundle with --reset-cache). Removes every
    // console.log/warn/info/debug call, arguments included, so release
    // builds don't format and ship hundreds of log lines to logcat/os_log.
    // console.error stays for adb/Console debugging of store builds;
    // Crashlytics is fed directly, not through console.
    production: {
      plugins: [['transform-remove-console', { exclude: ['error'] }]],
    },
  },
};
