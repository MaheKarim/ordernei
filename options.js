const form = document.getElementById("config-form");
const urlInput = document.getElementById("project-url");
const keyInput = document.getElementById("api-key");
const keyToggle = document.getElementById("key-toggle");
const testButton = document.getElementById("test-button");
const formStatus = document.getElementById("form-status");
const configState = document.getElementById("config-state");
const schemaCode = document.getElementById("schema-code");
const copySchemaButton = document.getElementById("copy-schema");
const lastResult = document.getElementById("last-result");
const historyList = document.getElementById("history-list");
const clearHistoryButton = document.getElementById("clear-history");
const openTableLink = document.getElementById("open-table");
const openSqlLink = document.getElementById("open-sql");
const openApiLink = document.getElementById("open-api");

const DASHBOARD_BASE = "https://supabase.com/dashboard";
const TABLE = "saved_urls";
const buttonResetTimers = new WeakMap();

init().catch((error) => {
  console.error("[URL Saver] Could not initialize options page:", error);
  setFormStatus("error", "Could not load settings. Reload this page and try again.");
});

async function init() {
  const stored = await chrome.storage.sync.get({
    supabaseUrl: "",
    supabaseKey: "",
  });

  urlInput.value = stored.supabaseUrl;
  keyInput.value = stored.supabaseKey;
  applyConfigState(stored);
  updateDashboardLinks(stored.supabaseUrl);

  document.getElementById("version").textContent =
    chrome.runtime.getManifest().version;

  copySchemaButton.disabled = true;
  wireEvents();
  loadSchema();
  refreshActivity();
}

function wireEvents() {
  form.addEventListener("submit", onSaveSettings);
  testButton.addEventListener("click", onTestConnection);
  keyToggle.addEventListener("click", toggleKeyVisibility);
  copySchemaButton.addEventListener("click", copySchema);
  clearHistoryButton.addEventListener("click", clearHistory);

  urlInput.addEventListener("input", () => {
    onFieldInput(urlInput);
    updateDashboardLinks(normalizeProjectUrl(urlInput.value));
  });
  keyInput.addEventListener("input", () => onFieldInput(keyInput));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.history || changes.lastResult) {
      refreshActivity();
    }
  });
}

async function onSaveSettings(event) {
  event.preventDefault();
  const config = readConfig();
  if (!config) return;

  try {
    await chrome.storage.sync.set({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    });

    urlInput.value = config.supabaseUrl;
    applyConfigState(config);
    updateDashboardLinks(config.supabaseUrl);
    setFormStatus(
      "success",
      "Settings saved. Click the extension icon on any page to save it.",
    );
  } catch (error) {
    console.error("[URL Saver] Could not save settings:", error);
    setFormStatus("error", "Could not save settings. Try again.");
  }
}

async function onTestConnection() {
  const config = readConfig();
  if (!config) return;

  setButtonBusy(testButton, true, "Testing…");
  setFormStatus("info", "Contacting Supabase…");

  try {
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/${TABLE}?select=id&limit=1`,
      {
        headers: {
          apikey: config.supabaseKey,
          Authorization: `Bearer ${config.supabaseKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(await describeHttpError(response));
    }

    setFormStatus(
      "success",
      "Connection works. Save these settings, then click the extension icon on any page.",
    );
  } catch (error) {
    console.error("[URL Saver] Connection test failed:", error);
    setFormStatus("error", explainConnectionError(error));
  } finally {
    setButtonBusy(testButton, false, "Test connection");
  }
}

function readConfig() {
  clearFormFeedback();

  const url = normalizeProjectUrl(urlInput.value);
  const key = keyInput.value.trim();
  let firstInvalid = null;

  if (!url) {
    setFieldError(
      urlInput,
      "Enter a valid project URL, like https://abcdefgh.supabase.co.",
    );
    firstInvalid = firstInvalid || urlInput;
  }

  if (!key) {
    setFieldError(
      keyInput,
      "Enter the anon or publishable key from your project settings.",
    );
    firstInvalid = firstInvalid || keyInput;
  } else if (isSecretKey(key)) {
    setFieldError(
      keyInput,
      "This looks like a secret key. Use the anon / publishable key instead — secret keys must never be shipped in an extension.",
    );
    firstInvalid = firstInvalid || keyInput;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }

  return { supabaseUrl: url, supabaseKey: key };
}

function normalizeProjectUrl(value) {
  let raw = value.trim();
  if (!raw) return "";
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }

  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    return "";
  }

  return parsed.origin;
}

function isSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;

  const parts = key.split(".");
  if (parts.length !== 3) return false;

  try {
    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

function applyConfigState({ supabaseUrl, supabaseKey }) {
  const ready = Boolean(supabaseUrl && supabaseKey);

  configState.textContent = ready ? "Configured" : "Not configured";
  configState.classList.toggle("is-ready", ready);
  configState.classList.toggle("is-empty", !ready);
}

function updateDashboardLinks(projectUrl) {
  const ref = projectRef(projectUrl);
  const base = ref ? `${DASHBOARD_BASE}/project/${ref}` : DASHBOARD_BASE;

  openTableLink.href = ref ? `${base}/editor` : DASHBOARD_BASE;
  openSqlLink.href = ref ? `${base}/sql/new` : DASHBOARD_BASE;
  openApiLink.href = ref ? `${base}/settings/api-keys` : DASHBOARD_BASE;
}

function projectRef(projectUrl) {
  try {
    const hostname = new URL(projectUrl).hostname;
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function toggleKeyVisibility() {
  const showing = keyInput.type === "text";
  keyInput.type = showing ? "password" : "text";
  keyToggle.textContent = showing ? "Show" : "Hide";
  keyToggle.setAttribute("aria-pressed", String(!showing));
  keyToggle.setAttribute(
    "aria-label",
    showing ? "Show API key" : "Hide API key",
  );
  keyInput.focus();
}

function onFieldInput(input) {
  clearFieldError(input);
  if (!formStatus.hidden) {
    setFormStatus("", "");
  }
}

function setFieldError(input, message) {
  const error = document.getElementById(`${input.id}-error`);
  input.classList.add("is-invalid");
  input.setAttribute("aria-invalid", "true");

  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
}

function clearFieldError(input) {
  const error = document.getElementById(`${input.id}-error`);
  input.classList.remove("is-invalid");
  input.removeAttribute("aria-invalid");

  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
}

function clearFormFeedback() {
  clearFieldError(urlInput);
  clearFieldError(keyInput);
  setFormStatus("", "");
}

function setFormStatus(kind, message) {
  formStatus.textContent = message;
  formStatus.className = "form-status";
  formStatus.hidden = !message;

  if (message && kind) {
    formStatus.classList.add(`is-${kind}`);
  }
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
  if (busy) {
    button.setAttribute("aria-busy", "true");
  } else {
    button.removeAttribute("aria-busy");
  }
}

async function describeHttpError(response) {
  let detail = "";

  try {
    const text = await response.text();
    if (text) {
      try {
        const body = JSON.parse(text);
        detail = body.message || body.hint || text;
      } catch {
        detail = text;
      }
    }
  } catch {
    // Fall back to the status code.
  }

  return detail ? `${detail} (HTTP ${response.status})` : `HTTP ${response.status}`;
}

function explainConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed")
  ) {
    return "Couldn't reach Supabase. Check the Project URL and your internet connection.";
  }
  if (lower.includes("does not exist") && lower.includes("relation")) {
    return "The saved_urls table doesn't exist yet. Run the SQL schema above in the Supabase SQL editor.";
  }
  if (
    lower.includes("invalid api key") ||
    lower.includes("invalid jwt") ||
    lower.includes("jwt expired")
  ) {
    return "Supabase rejected the API key. Use the publishable key (or legacy anon key) from Settings → API Keys.";
  }
  if (lower.includes("permission denied")) {
    return "The anon role doesn't have access. Run the full SQL schema above, including the grants.";
  }

  return message;
}

async function loadSchema() {
  try {
    const response = await fetch(chrome.runtime.getURL("supabase/schema.sql"));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    schemaCode.textContent = await response.text();
    copySchemaButton.disabled = false;
  } catch (error) {
    console.error("[URL Saver] Could not load schema:", error);
    schemaCode.textContent =
      "Could not load supabase/schema.sql. Open that file from the extension folder.";
  }
}

async function copySchema() {
  try {
    await navigator.clipboard.writeText(schemaCode.textContent);
    flashButton(copySchemaButton, "Copied!");
  } catch (error) {
    console.error("[URL Saver] Could not copy schema:", error);
    setFormStatus(
      "error",
      "Couldn't copy automatically. Select the SQL and copy it manually.",
    );
  }
}

function flashButton(button, label) {
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = button.textContent;
  }

  button.textContent = label;
  clearTimeout(buttonResetTimers.get(button));
  buttonResetTimers.set(
    button,
    setTimeout(() => {
      button.textContent = button.dataset.originalLabel;
    }, 1600),
  );
}

async function refreshActivity() {
  let stored;
  try {
    stored = await chrome.storage.local.get({
      history: [],
      lastResult: null,
    });
  } catch (error) {
    console.error("[URL Saver] Could not load local activity:", error);
    return;
  }

  const history = Array.isArray(stored.history) ? stored.history : [];
  const latest = stored.lastResult || history[0] || null;
  const older =
    latest && isSameEntry(history[0], latest) ? history.slice(1) : history;

  renderLastResult(latest);
  renderHistory(older.slice(0, 10));
  clearHistoryButton.disabled = history.length === 0;
}

function isSameEntry(first, second) {
  return Boolean(
    first &&
      second &&
      first.at === second.at &&
      first.url === second.url &&
      first.ok === second.ok,
  );
}

function renderLastResult(entry) {
  lastResult.replaceChildren();
  lastResult.classList.toggle("is-empty", !entry);

  if (!entry) {
    const empty = document.createElement("p");
    empty.textContent =
      "No saves yet. Click the extension icon on any page to save it.";
    lastResult.append(empty);
    return;
  }

  const icon = document.createElement("span");
  icon.className = `result-icon ${entry.ok ? "is-success" : "is-error"}`;
  icon.textContent = entry.ok ? "✓" : "!";
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "result-body";

  const headline = document.createElement("p");
  headline.className = "result-headline";
  headline.textContent = entry.ok ? "Saved to Supabase" : "Last save failed";

  const link = createUrlLink(entry.url, entry.title || entry.url);
  link.classList.add("result-link");

  const meta = document.createElement("p");
  meta.className = "result-meta";
  meta.textContent = formatTimestamp(entry.at);

  body.append(headline, link, meta);

  if (!entry.ok && entry.error) {
    const error = document.createElement("p");
    error.className = "result-error";
    error.textContent = entry.error;
    body.append(error);
  }

  lastResult.append(icon, body);
}

function renderHistory(entries) {
  historyList.replaceChildren();

  if (entries.length === 0) {
    historyList.hidden = true;
    return;
  }

  historyList.hidden = false;
  for (const entry of entries) {
    historyList.append(renderHistoryItem(entry));
  }
}

function renderHistoryItem(entry) {
  const item = document.createElement("li");
  item.className = "history-item";

  const status = document.createElement("span");
  status.className = `status-dot ${entry.ok ? "is-success" : "is-error"}`;
  status.textContent = entry.ok ? "✓" : "!";
  status.setAttribute("aria-label", entry.ok ? "Saved" : "Failed");

  const main = document.createElement("div");
  main.className = "history-main";

  const link = createUrlLink(entry.url, entry.title || entry.url);
  link.classList.add("history-link");

  const meta = document.createElement("p");
  meta.className = "history-meta";
  const time = document.createElement("time");
  time.dateTime = entry.at || "";
  time.textContent = formatTimestamp(entry.at);
  meta.append(time);

  main.append(link, meta);

  if (!entry.ok && entry.error) {
    const error = document.createElement("p");
    error.className = "history-error";
    error.textContent = entry.error;
    main.append(error);
  }

  item.append(status, main);
  return item;
}

function createUrlLink(url, label) {
  const isHttp = typeof url === "string" && /^https?:\/\//i.test(url);
  const element = document.createElement(isHttp ? "a" : "span");

  element.textContent = label || url || "Unknown page";
  element.title = url || "";

  if (isHttp) {
    element.href = url;
    element.target = "_blank";
    element.rel = "noreferrer noopener";
  }

  return element;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function clearHistory() {
  clearHistoryButton.disabled = true;

  try {
    await chrome.storage.local.remove(["history", "lastResult"]);
    await refreshActivity();
  } catch (error) {
    console.error("[URL Saver] Could not clear activity:", error);
    clearHistoryButton.disabled = false;
  }
}
