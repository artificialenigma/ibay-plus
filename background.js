/* iBay Plus — background service worker.
   Periodically re-checks watchlisted item pages for price changes and
   raises a notification when a watched price drops. */

const ALARM_NAME = "ibayplus-price-check";
const CHECK_PERIOD_MIN = 30;

/* Parse the main price out of an item page's HTML without a DOM.
   The main price is the first `.price` element on the page (inside .iw-price-row). */
function parsePriceFromHtml(html) {
  const m = /class="price">\s*<span class="currency">MVR<\/span>\s*([\d][\d,]*(?:\.\d+)?)/.exec(html);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function fetchItemPrice(url) {
  const res = await fetch(url, { credentials: "omit", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parsePriceFromHtml(html);
}

async function notifyPriceDrop(id, entry, newPrice, oldPrice) {
  const notifId = `drop-${id}-${Date.now()}`;
  openTargets.set(notifId, entry.url);
  const pct = (((newPrice - oldPrice) / oldPrice) * 100).toFixed(0);
  await chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Price drop on iBay ♥",
    message: `${entry.title}\n${IBAY_BG.fmt(oldPrice)} → ${IBAY_BG.fmt(newPrice)} (${pct}%)`,
    priority: 2,
  });
}

// Maps notification ids to item URLs so clicks open the listing.
const openTargets = new Map();
chrome.notifications.onClicked.addListener((notifId) => {
  const url = openTargets.get(notifId);
  if (url) {
    chrome.tabs.create({ url });
    chrome.notifications.clear(notifId);
    openTargets.delete(notifId);
  }
});

const IBAY_BG = {
  fmt(n) {
    return "MVR " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  },

  /** Check every watchlisted item once. Returns summary for the popup. */
  async checkAll() {
    const data = await chrome.storage.local.get(["settings", "watchlist"]);
    const settings = data.settings || {};
    const watchlist = data.watchlist || {};
    const alertsEnabled = settings.alertsEnabled !== false;
    const results = [];

    for (const id of Object.keys(watchlist)) {
      const entry = watchlist[id];
      let price = null;
      try {
        price = await fetchItemPrice(entry.url);
      } catch (e) {
        results.push({ id, ok: false, error: String(e) });
        continue;
      }
      if (price == null) {
        results.push({ id, ok: false, error: "no price found" });
        continue;
      }

      const old = entry.lastPrice;
      entry.lastCheckedAt = Date.now();
      if (old === price) {
        await chrome.storage.local.set({ watchlist });
        results.push({ id, ok: true, price, changed: false });
        continue;
      }

      entry.lastPrice = price;
      entry.history = (entry.history || []).concat([{ t: Date.now(), p: price }]);
      // keep history bounded
      if (entry.history.length > 100) entry.history = entry.history.slice(-100);
      await chrome.storage.local.set({ watchlist });

      const dropped = old != null && price < old;
      const thresholdHit = entry.alertBelow != null && price <= entry.alertBelow;
      if (alertsEnabled && (dropped || thresholdHit)) {
        await notifyPriceDrop(id, entry, price, old == null ? price : old);
      }
      results.push({ id, ok: true, price, changed: true, dropped });
    }
    return results;
  },

  async ensureAlarm() {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD_MIN });
    }
  },
};

chrome.runtime.onInstalled.addListener(() => IBAY_BG.ensureAlarm());
chrome.runtime.onStartup.addListener(() => IBAY_BG.ensureAlarm());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    IBAY_BG.checkAll().catch(console.warn);
  }
});

// Manual "check now" from the popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "ibayplus:checkPrices") {
    IBAY_BG.checkAll()
      .then((results) => sendResponse({ ok: true, results }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg && msg.type === "ibayplus:checkOne") {
    (async () => {
      const { watchlist } = await chrome.storage.local.get("watchlist");
      const entry = (watchlist || {})[msg.id];
      if (!entry) return sendResponse({ ok: false, error: "not on watchlist" });
      try {
        const price = await fetchItemPrice(entry.url);
        const old = entry.lastPrice;
        entry.lastCheckedAt = Date.now();
        if (price != null && price !== old) {
          entry.lastPrice = price;
          entry.history = (entry.history || []).concat([{ t: Date.now(), p: price }]);
          if (entry.history.length > 100) entry.history = entry.history.slice(-100);
          await chrome.storage.local.set({ watchlist });
          const dropped = old != null && price < old;
          const thresholdHit = entry.alertBelow != null && price <= entry.alertBelow;
          const { settings } = await chrome.storage.local.get("settings");
          if ((settings && settings.alertsEnabled !== false) && (dropped || thresholdHit)) {
            await notifyPriceDrop(msg.id, entry, price, old == null ? price : old);
          }
        }
        sendResponse({ ok: true, price });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
