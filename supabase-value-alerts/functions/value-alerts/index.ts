// value-alerts — Supabase Edge Function
//
// Two trigger modes, same engine:
//
//  A) POLLING (use this for MM2 — no Supabase migration needed): a schedule
//     invokes this function with ?poll=1; it fetches each POLL_SOURCES URL
//     (your public CDN file), diffs against its private snapshot, and pushes.
//     Your manual upload routine stays exactly as it is today.
//
//  B) STORAGE WEBHOOK (for apps whose values file IS uploaded to Supabase
//     Storage): a Database Webhook on storage.objects fires on upload.
//
// Every changed item → row in public.value_changes + one FCM push to topic
// `val_<game>_<slug>`, so only users holding/wishing that item are notified.
//
// Secrets (supabase secrets set ...):
//   FIREBASE_SA_MM2 / FIREBASE_SA_BLOX / FIREBASE_SA_ADOPTME — per-app
//     Firebase service-account JSON (or FIREBASE_SERVICE_ACCOUNT if shared)
// Optional:
//   WEBHOOK_SECRET — if set, requests must carry x-webhook-secret
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@5";

// ── POLLING MODE sources (MM2 first; add blox/adoptme later if wanted) ──
const POLL_SOURCES: { url: string; game: string; basename: string }[] = [
  { url: "https://mm2-api.b-cdn.net/mm2values.json", game: "mm2", basename: "mm2values.json" },
];

// ── WEBHOOK MODE: storage file basename → game (for Supabase-hosted files) ──
const FILE_GAME_MAP: Record<string, string> = {
  "data.json": "blox",
  // "adoptme.json": "adoptme",
};

const SNAPSHOT_BUCKET = "value-snapshots";
const MAX_PUSHES_PER_RUN = 400; // safety valve for a malformed upload

// Must stay in sync with slugItem() in the apps' valueAlerts.js helper —
// the topic string is the app↔server contract.
const slug = (name: string) =>
  String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

// Walk any JSON shape and collect {name, value} pairs — tolerant to each
// app's different nesting ({category:{tier:[items]}}, flat arrays, etc.).
function extractItems(node: unknown, out: Map<string, { name: string; value: number }>) {
  if (Array.isArray(node)) {
    for (const el of node) extractItems(el, out);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : typeof o.Name === "string" ? o.Name : null;
    if (name) {
      const value = toNum(o.value) ?? toNum(o.Value) ?? toNum(o.rvalue);
      if (value !== null) {
        const s = slug(name);
        if (s && !out.has(s)) out.set(s, { name, value });
        return; // item leaf — no need to recurse deeper
      }
    }
    for (const v of Object.values(o)) extractItems(v, out);
  }
}

async function fcmAccessToken(sa: { client_email: string; private_key: string }) {
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`oauth ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

// ── Core engine: diff newText vs snapshot, log changes, push, save snapshot ──
async function processFile(supabase: SupabaseClient, game: string, basename: string, newText: string) {
  let newJson: unknown;
  try {
    newJson = JSON.parse(newText);
  } catch {
    return { game, skipped: "invalid JSON" };
  }
  const newItems = new Map<string, { name: string; value: number }>();
  extractItems(newJson, newItems);
  if (newItems.size === 0) return { game, skipped: "no items parsed" };

  const snapPath = `${game}/${basename}`;
  const { data: oldBlob } = await supabase.storage.from(SNAPSHOT_BUCKET).download(snapPath);

  const changes: { slug: string; name: string; oldV: number; newV: number }[] = [];
  let firstRun = true;
  let oldText: string | null = null;
  if (oldBlob) {
    try {
      oldText = await oldBlob.text();
      const oldItems = new Map<string, { name: string; value: number }>();
      extractItems(JSON.parse(oldText), oldItems);
      if (oldItems.size > 0) firstRun = false;
      for (const [s, item] of newItems) {
        const prev = oldItems.get(s);
        if (prev && prev.value !== item.value) {
          changes.push({ slug: s, name: item.name, oldV: prev.value, newV: item.value });
        }
      }
    } catch {
      // corrupt snapshot — treat as first run and force a fresh re-upload
      oldText = null;
    }
  }

  // ✅ COST: only re-upload the snapshot when the file actually changed. On a
  // no-change run (the common case — values update ~once/day) the stored
  // snapshot is already byte-identical, so skip the Storage write. Raw-text
  // compare (not just value diffs) still captures added/removed items.
  if (oldText === null || newText !== oldText) {
    await supabase.storage
      .from(SNAPSHOT_BUCKET)
      .upload(snapPath, new Blob([newText], { type: "application/json" }), { upsert: true });
  }

  if (firstRun || changes.length === 0) {
    return { game, items: newItems.size, changes: 0, firstRun };
  }

  // Log changes (also feeds a future in-app "Value Changes" screen + charts).
  await supabase.from("value_changes").insert(
    changes.map((c) => ({
      game,
      item_slug: c.slug,
      item_name: c.name,
      old_value: c.oldV,
      new_value: c.newV,
    })),
  );

  // Push to each item's topic via the game's own Firebase project.
  let pushed = 0;
  try {
    const saRaw =
      Deno.env.get(`FIREBASE_SA_${game.toUpperCase()}`) ??
      Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ??
      "";
    const sa = JSON.parse(saRaw);
    const token = await fcmAccessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    const batch = changes.slice(0, MAX_PUSHES_PER_RUN);
    const CHUNK = 10;
    for (let i = 0; i < batch.length; i += CHUNK) {
      await Promise.all(
        batch.slice(i, i + CHUNK).map(async (c) => {
          const up = c.newV > c.oldV;
          const body = {
            message: {
              topic: `val_${game}_${c.slug}`,
              notification: {
                title: `${c.name} value ${up ? "increased! 📈" : "changed 📉"}`,
                body: `${c.oldV.toLocaleString()} → ${c.newV.toLocaleString()} (${up ? "+" : ""}${(c.newV - c.oldV).toLocaleString()})`,
              },
              data: { kind: "value_change", game, item: c.slug },
              android: { priority: "HIGH" },
            },
          };
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (r.ok) pushed++;
        }),
      );
    }
  } catch (e) {
    console.error(`FCM error (${game}):`, e);
  }

  return { game, items: newItems.size, changes: changes.length, pushed };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (secret && req.headers.get("x-webhook-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);

  // ── Mode A: polling (?poll=1 or scheduled invocation with no JSON body) ──
  let payload: any = null;
  if (req.method === "POST") {
    try {
      payload = await req.json();
    } catch {
      payload = null;
    }
  }
  const isPoll = url.searchParams.get("poll") === "1" || !payload?.record;

  if (isPoll) {
    const results = [];
    for (const src of POLL_SOURCES) {
      try {
        // Cache-bust so we see the freshest file even behind the CDN.
        const res = await fetch(`${src.url}?vcheck=${Date.now()}`, {
          headers: { "cache-control": "no-cache" },
        });
        if (!res.ok) {
          results.push({ game: src.game, skipped: `fetch ${res.status}` });
          continue;
        }
        results.push(await processFile(supabase, src.game, src.basename, await res.text()));
      } catch (e) {
        results.push({ game: src.game, skipped: String(e) });
      }
    }
    return new Response(JSON.stringify({ mode: "poll", results }), { status: 200 });
  }

  // ── Mode B: storage webhook ──
  const record = payload.record;
  const objectPath: string = record?.name ?? "";
  const bucketId: string = record?.bucket_id ?? "";
  const basename = objectPath.split("/").pop() ?? "";
  const game = FILE_GAME_MAP[basename];
  if (!game || bucketId === SNAPSHOT_BUCKET) return new Response("ignored", { status: 200 });

  const { data: newBlob, error: dlErr } = await supabase.storage.from(bucketId).download(objectPath);
  if (dlErr || !newBlob) return new Response(`download failed: ${dlErr?.message}`, { status: 500 });

  const result = await processFile(supabase, game, basename, await newBlob.text());
  return new Response(JSON.stringify({ mode: "webhook", result }), { status: 200 });
});
