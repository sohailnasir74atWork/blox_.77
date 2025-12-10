// utils/countryEmoji.js
import * as RNLocalize from "react-native-localize";

// internal helper: code -> emoji
const countryCodeToEmoji = (countryCode) => {
  if (!countryCode) return "";

  const code = countryCode.toUpperCase();
  if (code.length !== 2) return "";

  const A = 0x41;        // 'A'
  const OFFSET = 0x1f1e6; // regional indicator offset

  const first = code.charCodeAt(0);
  const second = code.charCodeAt(1);

  if (
    first < A || first > A + 25 ||
    second < A || second > A + 25
  ) {
    return "";
  }

  return String.fromCodePoint(
    OFFSET + (first - A),
    OFFSET + (second - A)
  );
};

// 🔹 This is what you call in your app
export const getFlag = (userCountryCode) => {
  // prefer explicit user country if you have it
  const countryCode = userCountryCode || RNLocalize.getCountry(); // e.g. "US"
  return countryCodeToEmoji(countryCode);
};
