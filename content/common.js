/* Shared helpers for iBay Plus content scripts. */

const IBAY_PLUS = {
  DEFAULTS: {
    settings: {
      hideKeywords: [],
      highlightKeywords: [],
      alertsEnabled: true,
      priceFilter: {
        min: null,          // MVR lower bound (null = off)
        max: null,          // MVR upper bound (null = off)
        hideUnstated: false // hide "price not stated" posts
      },
      spamFilter: {
        enabled: true,
        allCaps: false,       // opt-in: ALL-CAPS titles are normal practice on ibay
        maxPhones: 3,         // hide titles with >= N phone-number-like runs (0 = off)
        repeatedJunk: true,   // hide titles with long runs of repeated chars/punct/emoji
        maxPostsPerSeller: 0, // collapse sellers posting more than N listings (0 = off)
        blockSellers: {},     // sellerId -> { name, at }
      },
    },
    watchlist: {},
  },

  /** Read the whole store (settings + watchlist), with defaults filled in —
      including nested defaults for spamFilter (older installs lack it). */
  async load() {
    const data = await chrome.storage.local.get(["settings", "watchlist"]);
    const settings = Object.assign({}, IBAY_PLUS.DEFAULTS.settings, data.settings || {});
    settings.spamFilter = Object.assign(
      {}, IBAY_PLUS.DEFAULTS.settings.spamFilter, settings.spamFilter || {});
    settings.priceFilter = Object.assign(
      {}, IBAY_PLUS.DEFAULTS.settings.priceFilter, settings.priceFilter || {});
    return {
      settings,
      watchlist: data.watchlist || {},
    };
  },

  /** Persist a partial store. */
  async save(partial) {
    await chrome.storage.local.set(partial);
  },

  /**
   * Extract the numeric item id from any iBay item URL.
   * Item pages look like: slug-text-o6535971.html
   */
  itemIdFromUrl(url) {
    const m = /-o(\d+)\.html/.exec(url || "");
    return m ? m[1] : null;
  },

  /** Extract seller profile id from an index.php?page=profile&id=N href. */
  sellerIdFromUrl(url) {
    const m = /[?&]id=(\d+)/.exec(url || "");
    return m ? m[1] : null;
  },

  /** Parse "MVR 4,300.00" style text into a number (null when absent). */
  parsePrice(text) {
    if (!text) return null;
    const cleaned = text.replace(/[\u00a0\s]/g, " ");
    const m = /([\d][\d,]*(?:\.\d{1,2})?)/.exec(cleaned);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  },

  /** Format a price for display, e.g. "MVR 4,300.00" -> "MVR 4,300". */
  formatPrice(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    return "MVR " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  },

  /** Short relative time, e.g. "3h ago". */
  timeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  },

  /** Escape text for safe HTML interpolation. */
  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },
};
