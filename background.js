// URL Saver for Supabase — background service worker.
// A click on the toolbar icon inserts the active tab into `public.saved_urls`.

const TABLE = "saved_urls";
const DEFAULT_TITLE = "Save this page to Supabase";
const BADGE_RESET_MS = 2600;

const COLORS = {
  progress: "#4f46e5",
  success: "#16a34a",
  error: "#dc2626",
  warning: "#d97706",
};

let resetTimer = null;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener((tab) => {
  saveTab(tab).catch((error) => {
    console.error("[URL Saver] Unexpected failure:", error);
    void finishWithBadge(
      "!",
      COLORS.error,
      "Save failed — open the extension options for details",
    );
  });
});

async function saveTab(tab) {
  clearResetTimer();
  await setBadge("…", COLORS.progress);

  const url = tab?.url ?? "";
  const title = tab?.title ?? "";

  // chrome://, edge://, extension pages, file://, etc. cannot be saved.
  if (!/^https?:\/\//i.test(url)) {
    await recordEvent({
      ok: false,
      url,
      title,
      error: "Only http:// and https:// pages can be saved.",
    });
    await finishWithBadge(
      "!",
      COLORS.warning,
      "Only http and https pages can be saved",
    );
    return;
  }

  const { supabaseUrl, supabaseKey } = await getConfig();

  if (!supabaseUrl || !supabaseKey) {
    await finishWithBadge(
      "?",
      COLORS.warning,
      "Set up your Supabase project first",
    );
    await chrome.runtime.openOptionsPage();
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ url, title: title || null }),
    });

    if (!response.ok) {
      throw new Error(await readSupabaseError(response));
    }

    await recordEvent({ ok: true, url, title, error: null });
    await finishWithBadge("✓", COLORS.success, "Saved to Supabase");
  } catch (error) {
    const message = explainError(error);
    await recordEvent({ ok: false, url, title, error: message });
    await finishWithBadge(
      "!",
      COLORS.error,
      "Save failed — open the extension options for details",
    );
    console.error("[URL Saver] Save failed:", error);
  }
}

async function getConfig() {
  const { supabaseUrl = "", supabaseKey = "" } = await chrome.storage.sync.get({
    supabaseUrl: "",
    supabaseKey: "",
  });

  return {
    supabaseUrl: String(supabaseUrl).trim().replace(/\/+$/, ""),
    supabaseKey: String(supabaseKey).trim(),
  };
}

async function recordEvent(event) {
  const entry = { ...event, at: new Date().toISOString() };

  try {
    const stored = await chrome.storage.local.get({ history: [] });
    const history = Array.isArray(stored.history) ? stored.history : [];
    history.unshift(entry);

    await chrome.storage.local.set({
      history: history.slice(0, 20),
      lastResult: entry,
    });
  } catch (error) {
    console.error("[URL Saver] Could not store local history:", error);
  }
}

async function readSupabaseError(response) {
  let detail = "";

  try {
    const text = await response.text();
    if (text) {
      try {
        const body = JSON.parse(text);
        detail =
          body.message || body.hint || body.error_description || body.error || text;
      } catch {
        detail = text;
      }
    }
  } catch {
    // Ignore body read failures and fall back to the HTTP status.
  }

  return detail ? `HTTP ${response.status} — ${detail}` : `HTTP ${response.status}`;
}

function explainError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed")
  ) {
    return "Could not reach Supabase. Check the Project URL and your internet connection.";
  }
  if (
    lower.includes("invalid api key") ||
    lower.includes("invalid jwt") ||
    lower.includes("jwt expired")
  ) {
    return "Supabase rejected the API key. Update it in the extension options.";
  }
  if (lower.includes("row-level security") || lower.includes("row level security")) {
    return "Row Level Security blocked the insert. Run the insert policy in supabase/schema.sql.";
  }
  if (lower.includes("does not exist") && lower.includes("relation")) {
    return `Table "${TABLE}" was not found. Run supabase/schema.sql in the Supabase SQL editor.`;
  }
  if (lower.includes("permission denied")) {
    return "The anon role cannot insert into saved_urls. Run the grants in supabase/schema.sql.";
  }

  return message;
}

async function finishWithBadge(text, color, title) {
  await Promise.all([
    setBadge(text, color),
    chrome.action.setTitle({ title }),
  ]);
  scheduleReset();
}

async function setBadge(text, color) {
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setBadgeText({ text }),
  ]);
}

function scheduleReset() {
  clearResetTimer();
  resetTimer = setTimeout(() => {
    resetTimer = null;
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: DEFAULT_TITLE });
  }, BADGE_RESET_MS);
}

function clearResetTimer() {
  if (resetTimer !== null) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
}
