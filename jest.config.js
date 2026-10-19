module.exports = {
  preset: '@react-native/jest-preset',
  // functions/test/* are node/emulator scripts (run with node or
  // firebase emulators:exec), not jest suites; .claude/ holds session worktrees.
  testPathIgnorePatterns: ['/node_modules/', '/.claude/', '<rootDir>/functions/'],
};
