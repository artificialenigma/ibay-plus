/* iBay Plus — listing page enhancements:
   - watchlist heart button on every listing card
   - hide listings matching blocklist keywords (with a summary bar)
   - highlight listings matching watch keywords
   - "since saved" price badge for watchlisted items */

(function () {
  "use strict";

  let store = null; // { settings, watchlist }

  function firstPriceInRow(row) {
    const el = row.querySelector(".price");
    return el ? IBAY_PLUS.parsePrice(el.textContent) : null;
  }

  function extractItem(row) {
    const link = row.querySelector("h5 a") || row.querySelector(".image a");
    if (!link) return null;
    const id = IBAY_PLUS.itemIdFromUrl(link.getAttribute("href"));
    if (!id) return null;

    const img = row.querySelector(".image img");
    const thumb = img ? (img.getAttribute("data-src") || img.getAttribute("src")) : null;
    const sellerA = row.querySelector(".iw-by-seller a");

    return {
      id,
      url: link.href.split("?")[0],
      title: link.textContent.trim(),
      price: firstPriceInRow(row),
      image: thumb,
      seller: sellerA ? sellerA.textContent.trim() : "",
      sellerUrl: sellerA ? sellerA.href : "",
    };
  }

  function matchesAnyKeyword(title, keywords) {
    const t = title.toLowerCase();
    return keywords.some((k) => {
      const kw = String(k).trim().toLowerCase();
      return kw && t.includes(kw);
    });
  }

  /** Heart button (own storage — works without an ibay account). */
  function buildWatchBtn(item, watched) {
    const btn = document.createElement("button");
    btn.className = "ibp-watch-btn" + (watched ? " ibp-watched" : "");
    btn.type = "button";
    btn.title = watched ? "On your iBay Plus watchlist" : "Save to iBay Plus watchlist";
    btn.textContent = watched ? "♥" : "♡";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { settings, watchlist } = await IBAY_PLUS.load();
      if (watchlist[item.id]) {
        delete watchlist[item.id];
      } else {
        watchlist[item.id] = {
          id: item.id,
          url: item.url,
          title: item.title,
          price: item.price,
          image: item.image,
          seller: item.seller,
          sellerUrl: item.sellerUrl,
          note: "",
          addedAt: Date.now(),
          lastSeenAt: Date.now(),
          lastPrice: item.price,
          history: item.price != null ? [{ t: Date.now(), p: item.price }] : [],
          alertBelow: null,
        };
      }
      await IBAY_PLUS.save({ watchlist });
    });
    return btn;
  }

  function decorate(row, settings, watchlist) {
    const item = extractItem(row);
    if (!item) return;

    row.classList.add("ibp-card");
    row.style.position = "relative";

    // --- watch button ---
    let btn = row.querySelector(".ibp-watch-btn");
    if (!btn) {
      btn = buildWatchBtn(item, false);
      row.appendChild(btn);
    }
    const watched = !!watchlist[item.id];
    btn.classList.toggle("ibp-watched", watched);
    btn.textContent = watched ? "♥" : "♡";
    btn.title = watched ? "On your iBay Plus watchlist" : "Save to iBay Plus watchlist";

    // --- "since saved" price badge ---
    let badge = row.querySelector(".ibp-since-badge");
    const w = watchlist[item.id];
    if (watched && w && w.price != null && item.price != null && item.price !== w.price) {
      const diff = item.price - w.price;
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ibp-since-badge";
        row.appendChild(badge);
      }
      const pct = ((diff / w.price) * 100).toFixed(0);
      badge.textContent = `${diff < 0 ? "▼" : "▲"} ${IBAY_PLUS.formatPrice(item.price)} (${pct}%)`;
      badge.classList.toggle("ibp-drop", diff < 0);
      badge.classList.toggle("ibp-rise", diff > 0);
    } else if (badge) {
      badge.remove();
    }

    // --- keyword filters ---
    const title = item.title;
    const hidden = matchesAnyKeyword(title, settings.hideKeywords);
    const highlighted = matchesAnyKeyword(title, settings.highlightKeywords);
    row.classList.toggle("ibp-hidden-row", hidden);
    row.classList.toggle("ibp-highlight-row", highlighted && !hidden);

    if (highlighted && !hidden && !row.querySelector(".ibp-match-badge")) {
      const mb = document.createElement("span");
      mb.className = "ibp-match-badge";
      mb.textContent = "★ match";
      row.appendChild(mb);
    }
    if (!highlighted || hidden) {
      const mb = row.querySelector(".ibp-match-badge");
      if (mb) mb.remove();
    }

    return { item, hidden };
  }

  /** Bar showing how many rows were hidden + button to reveal them. */
  function renderHiddenBar(rows, revealed) {
    document.querySelectorAll(".ibp-hidden-bar").forEach((el) => el.remove());
    const hiddenCount = [...rows].filter((r) =>
      r.classList.contains("ibp-hidden-row")).length;
    if (!hiddenCount || revealed) return;

    const first = rows[0];
    if (!first || !first.parentElement) return;

    const bar = document.createElement("div");
    bar.className = "ibp-hidden-bar";
    bar.innerHTML =
      `🚫 iBay Plus hid ${hiddenCount} listing${hiddenCount === 1 ? "" : "s"} by keyword — ` +
      `<a href="#">show them</a>`;
    bar.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".ibp-hidden-row").forEach((r) =>
        r.classList.remove("ibp-hidden-row"));
      bar.remove();
    });
    first.parentElement.insertBefore(bar, first);
  }

  async function run() {
    const rows = document.querySelectorAll(".latest-list-item");
    if (!rows.length) return;

    store = await IBAY_PLUS.load();

    let any = false;
    rows.forEach((row) => {
      const res = decorate(row, store.settings, store.watchlist);
      if (res) any = true;
    });
    if (any) renderHiddenBar(rows, false);

    // Re-apply when settings / watchlist change (e.g. from the popup).
    chrome.storage.onChanged.addListener(async () => {
      const fresh = await IBAY_PLUS.load();
      store = fresh;
      document.querySelectorAll(".latest-list-item").forEach((row) =>
        decorate(row, fresh.settings, fresh.watchlist));
    });
  }

  run();
})();
