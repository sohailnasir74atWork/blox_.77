// The "Announcements" bot that posts scheduled public-chat messages
// (supabase/061_chat_schedules.sql, Admin Dashboard ▸ Content ▸ Scheduled
// messages). Its profile row lives in Supabase only; it has no RTDB
// /users record, so there is no profile, DM or trade to open for it.
export const ANNOUNCEMENTS_BOT_UID = 'announcements_bot';

export const isBotUid = (uid) => uid === ANNOUNCEMENTS_BOT_UID;
