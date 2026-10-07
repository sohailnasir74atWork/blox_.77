/**
 * birthdayDate.js — month/day helpers for the Birthdays feature (ported from
 * Adopt Me, adoptme-jan7/Code/Birthdays, 2026-10-07).
 *
 * Only month and day ever leave the server (supabase/036_birthdays.sql);
 * the year and age are never shown anywhere. 29 Feb is celebrated on 28 Feb
 * in non-leap years, matching the server.
 */

const DOB_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/** 'YYYY-MM-DD' → { month, day } (1-based), or null. */
export const monthDayFromDob = (dob) => {
  const m = typeof dob === 'string' ? DOB_RE.exec(dob.trim()) : null;
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
};

/** Under 13 (Adopt Me's MINOR_AGE_THRESHOLD; safe_chat_minor_age() in 036). Unknown = false. */
export const isUnder13Dob = (dob) => {
  const m = typeof dob === 'string' ? DOB_RE.exec(dob.trim()) : null;
  if (!m) return false;
  const now = new Date();
  let age = now.getFullYear() - Number(m[1]);
  const mo = now.getMonth() + 1;
  if (mo < Number(m[2]) || (mo === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
  return age >= 0 && age <= 120 && age < 13;
};

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// The local calendar date this year's birthday falls on.
const birthdayIn = (year, month, day) => {
  const d = month === 2 && day === 29 && !isLeap(year) ? 28 : day;
  return new Date(year, month - 1, d);
};

const startOfToday = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** Whole days from today (local) to the next birthday; 0 = today. */
export const daysUntilBirthday = (month, day, now = new Date()) => {
  if (!month || !day) return null;
  const today = startOfToday(now);
  let next = birthdayIn(today.getFullYear(), month, day);
  if (next < today) next = birthdayIn(today.getFullYear() + 1, month, day);
  return Math.round((next - today) / 86400000);
};

export const isBirthdayToday = (month, day, now = new Date()) =>
  daysUntilBirthday(month, day, now) === 0;

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct" / "окт." — a month's short name in the user's language (Blox has no dob.months keys). */
export const monthShortName = (month, lang = 'en') => {
  try {
    return new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2000, month - 1, 1)));
  } catch (_) {
    return MONTHS_EN[month - 1] || '';
  }
};

/** "12 Oct" / "Oct 12" / "12 окт." — the user's language, no year. */
export const formatMonthDay = (month, day, lang = 'en') => {
  if (!month || !day) return '';
  try {
    // A leap year so 29 Feb formats; UTC so no time zone can shift the day.
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2000, month - 1, day)));
  } catch (_) {
    return `${day} ${MONTHS_EN[month - 1]}`;
  }
};

/** "Sat 12 Oct" for an upcoming birthday, in the user's language. */
export const formatUpcoming = (month, day, lang = 'en', now = new Date()) => {
  const until = daysUntilBirthday(month, day, now);
  if (until == null) return '';
  const date = new Date(startOfToday(now).getTime() + until * 86400000);
  try {
    return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  } catch (_) {
    return formatMonthDay(month, day, lang);
  }
};
