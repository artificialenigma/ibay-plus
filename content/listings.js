/* iBay Plus — listing page enhancements:
   - watchlist heart button on every listing card
   - spam removal: seller block button, heuristics (ALL-CAPS, phone spam,
     junk chars), optional flood cap — hidden before you see them
   - keyword hide/highlight
   - combined "hidden listings" bar with reveal
   - MutationObserver so late-added cards get decorated too */

(function () {
  "use strict";

  let settings = null;
  let watchlist = null;
  let revealed = false; // user clicked "show them" — don't re-hide until reload

  const ctx = { counts: { keyword: 0, spam: 0, flood: 0 }, seenSellers: null };

  /* ---------- extraction ---------- */

  function extractItem(row) {
    const link = row.querySelector("h5 a") || row.querySelector(".image a");
    if (!link) return null;
    const id = IBAY_PLUS.itemIdFromUrl(link.getAttribute("href"));
    if (!id) return null;

    const img = row.querySelector(".image img");
    const thumb = img ? (img.getAttribute("data-src") || img.getAttribute("src")) : null;
    const sellerA = row.querySelector(".iw-by-seller a");
    const sellerId = sellerA ? IBAY_PLUS.sellerIdFromUrl(sellerA.getAttribute("href")) : null;

    return {
      id,
      url: link.href.split("?")[0],
      title: link.textContent.trim(),
      price: (() => {
        const el = row.querySelector(".price");
        return el ? IBAY_PLUS.parsePrice(el.textContent) : null;
      })(),
      image: thumb,
      seller: sellerA ? sellerA.textContent.trim() : "",
      sellerId,
      sellerUrl: sellerA ? sellerA.href : "",
    };
  }

  /* ---------- spam detection ---------- */

  function spamReason(item) {
    const sf = settings.spamFilter;
    if (!sf.enabled || !item) return null;
    const t = item.title || "";

    // seller the user hid
    if (item.sellerId && sf.blockSellers[item.sellerId]) return "seller you hid";

    // flooding: too many phone numbers in the title
    if (sf.maxPhones > 0) {
      const phones = (t.match(/\d{6,}/g) || []).length;
      if (phones >= sf.maxPhones) return `${phones} phone numbers`;
    }

    // ALL-CAPS shouting
    if (sf.allCaps) {
      const letters = t.replace(/[^a-zA-Z]/g, "");
      if (letters.length >= 14) {
        const caps = t.replace(/[^A-Z]/g, "");
        if (caps.length / letters.length >= 0.85) return "ALL-CAPS title";
      }
    }

    // long runs of repeated characters / punctuation / emoji
    if (sf.repeatedJunk && (
      /(.)\1{5,}/.test(t) ||
      /[!$*#-]{4,}/.test(t) ||
      /(?:\p{Extended_Pictographic}\s*){6,}/u.test(t)
    )) {
      return "junk characters";
    }
    return null;
  }

  function sellerBlocked(item) {
    const sf = settings.spamFilter;
    return !!(item.sellerId && sf.enabled && sf.blockSellers[item.sellerId]);
  }

  /* ---------- decoration ---------- */

  function buildWatchBtn(item) {
    const btn = document.createElement("button");
    btn.className = "ibp-watch-btn";
    btn.type = "button";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const store = await IBAY_PLUS.load();
      if (store.watchlist[item.id]) {
        delete store.watchlist[item.id];
      } else {
        store.watchlist[item.id] = {
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
      await IBAY_PLUS.save({ watchlist: store.watchlist });
    });
    return btn;
  }

  function buildHideSellerBtn(item) {
    const btn = document.createElement("a");
    btn.className = "ibp-hide-seller";
    btn.href = "#";
    btn.title = "Hide this seller's listings (iBay Plus)";
    btn.textContent = "🚫";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!item.sellerId) return;
      const store = await IBAY_PLUS.load();
      store.settings.spamFilter.blockSellers[item.sellerId] = {
        name: item.seller || `seller ${item.sellerId}`,
        at: Date.now(),
      };
      await IBAY_PLUS.save({ settings: store.settings });
      showToast(`Seller "${item.seller}" hidden`, async () => {
        const st = await IBAY_PLUS.load();
        delete st.settings.spamFilter.blockSellers[item.sellerId];
        await IBAY_PLUS.save({ settings: st.settings });
      });
      applyAll();
    });
    return btn;
  }

  function decorate(row) {
    const item = extractItem(row);
    if (!item) return null;

    row.classList.add("ibp-card");
    row.style.position = "relative";

    // watch heart
    let btn = row.querySelector(".ibp-watch-btn");
    if (!btn) { btn = buildWatchBtn(item); row.appendChild(btn); }
    const watched = !!watchlist[item.id];
    btn.classList.toggle("ibp-watched", watched);
    btn.textContent = watched ? "♥" : "♡";
    btn.title = watched ? "On your iBay Plus watchlist" : "Save to iBay Plus watchlist";

    // hide-seller chip next to the seller name
    const by = row.querySelector(".iw-prod-by");
    if (by && item.sellerId && !by.querySelector(".ibp-hide-seller")) {
      by.appendChild(buildHideSellerBtn(item));
    }

    // "since saved" price badge
    let badge = row.querySelector(".ibp-since-badge");
    const w = watchlist[item.id];
    if (watched && w && w.price != null && item.price != null && item.price !== w.price) {
      const diff = item.price - w.price;
      if (!badge) { badge = document.createElement("span"); badge.className = "ibp-since-badge"; row.appendChild(badge); }
      const pct = ((diff / w.price) * 100).toFixed(0);
      badge.textContent = `${diff < 0 ? "▼" : "▲"} ${IBAY_PLUS.formatPrice(item.price)} (${pct}%)`;
      badge.classList.toggle("ibp-drop", diff < 0);
      badge.classList.toggle("ibp-rise", diff > 0);
    } else if (badge) badge.remove();

    // keyword highlight
    const highlighted = settings.highlightKeywords.some((k) => {
      const kw = String(k).trim().toLowerCase();
      return kw && item.title.toLowerCase().includes(kw);
    });
    row.classList.toggle("ibp-highlight-row", highlighted);
    let mb = row.querySelector(".ibp-match-badge");
    if (highlighted && !mb) {
      mb = document.createElement("span");
      mb.className = "ibp-match-badge";
      mb.textContent = "★ match";
      row.appendChild(mb);
    } else if (!highlighted && mb) mb.remove();

    // hiding: keyword > spam/seller > price
    const kwHit = settings.hideKeywords.some((k) => {
      const kw = String(k).trim().toLowerCase();
      return kw && item.title.toLowerCase().includes(kw);
    });
    let reason = null;
    if (kwHit) { reason = "keyword"; ctx.counts.keyword++; }
    else {
      reason = spamReason(item);
      if (reason) ctx.counts.spam++;
    }
    if (!reason) {
      const pf = settings.priceFilter;
      const outOfRange =
        (pf.min != null && item.price != null && item.price < pf.min) ||
        (pf.max != null && item.price != null && item.price > pf.max);
      const unstated = pf.hideUnstated && item.price == null;
      if (outOfRange || unstated) { reason = "price"; ctx.counts.price++; }
    }
    const hidden = !!reason && !revealed;
    row.classList.toggle("ibp-hidden-row", hidden);
    row.classList.toggle("ibp-highlight-row", highlighted && !hidden);
    if (mb && hidden) mb.remove();

    return { item, hidden, reason };
  }

  /* ---------- flood cap ---------- */

  function applyFloodCap() {
    const max = Number(settings.spamFilter.maxPostsPerSeller) || 0;
    if (max <= 0) return;
    const counts = new Map();
    document.querySelectorAll(".latest-list-item").forEach((row) => {
      const link = row.querySelector("h5 a") || row.querySelector(".image a");
      if (!link) return;
      const sellerA = row.querySelector(".iw-by-seller a");
      const sid = sellerA ? IBAY_PLUS.sellerIdFromUrl(sellerA.getAttribute("href")) : null;
      if (!sid) return;
      const n = (counts.get(sid) || 0) + 1;
      counts.set(sid, n);
      const over = n > max && !revealed;
      if (over && !row.classList.contains("ibp-hidden-row")) {
        row.classList.add("ibp-hidden-row", "ibp-flood-row");
        ctx.counts.flood++;
      }
    });
  }

  /* ---------- price filter bar ---------- */

  function ensurePriceBar() {
    let bar = document.querySelector(".ibp-price-bar");
    if (bar) return bar;
    const rows = document.querySelectorAll(".latest-list-item");
    if (!rows.length) return null;

    bar = document.createElement("div");
    bar.className = "ibp-price-bar";
    bar.innerHTML = `
      <span class="ibp-price-title">💰 iBay Plus price</span>
      <label>MVR <input type="number" class="ibp-pf-min" min="0" placeholder="min"></label>
      <span class="ibp-pf-dash">–</span>
      <label>MVR <input type="number" class="ibp-pf-max" min="0" placeholder="max"></label>
      <label class="ibp-pf-unstated"><input type="checkbox" class="ibp-pf-hu"> hide "not stated"</label>
      <span class="ibp-pf-count"></span>
      <a href="#" class="ibp-pf-clear">clear</a>`;

    const minInp = bar.querySelector(".ibp-pf-min");
    const maxInp = bar.querySelector(".ibp-pf-max");
    const huInp = bar.querySelector(".ibp-pf-hu");
    const pf = settings.priceFilter || {};
    if (pf.min != null) minInp.value = pf.min;
    if (pf.max != null) maxInp.value = pf.max;
    huInp.checked = !!pf.hideUnstated;

    let t = null;
    const saveSoon = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const min = parseFloat(minInp.value);
        const max = parseFloat(maxInp.value);
        let lo = Number.isFinite(min) && min >= 0 ? min : null;
        let hi = Number.isFinite(max) && max >= 0 ? max : null;
        if (lo != null && hi != null && lo > hi) {
          const tmp = lo; lo = hi; hi = tmp;
          minInp.value = lo; maxInp.value = hi;
        }
        const st = await IBAY_PLUS.load();
        st.settings.priceFilter = { min: lo, max: hi, hideUnstated: huInp.checked };
        await IBAY_PLUS.save({ settings: st.settings });
        applyAll(); // onChanged also fires; double-apply is harmless
      }, 400);
    };
    minInp.addEventListener("input", saveSoon);
    maxInp.addEventListener("input", saveSoon);
    huInp.addEventListener("change", saveSoon);
    bar.querySelector(".ibp-pf-clear").addEventListener("click", (e) => {
      e.preventDefault();
      minInp.value = ""; maxInp.value = ""; huInp.checked = false;
      saveSoon();
    });

    rows[0].parentElement.insertBefore(bar, rows[0]);
    return bar;
  }

  function updatePriceBarCount() {
    const bar = document.querySelector(".ibp-price-bar");
    if (!bar) return;
    const n = ctx.counts.price;
    bar.querySelector(".ibp-pf-count").textContent = n ? `${n} hidden` : "";
    bar.classList.toggle("ibp-pf-active", n > 0);
  }

  /* ---------- hidden bar & toast ---------- */

  function renderBar() {
    document.querySelectorAll(".ibp-hidden-bar").forEach((el) => el.remove());
    const c = ctx.counts;
    const total = c.keyword + c.spam + c.flood;
    if (!total) return;

    const rows = document.querySelectorAll(".latest-list-item");
    const first = rows[0];
    if (!first || !first.parentElement) return;

    const parts = [];
    if (c.keyword) parts.push(`${c.keyword} by keyword`);
    if (c.spam) parts.push(`${c.spam} spam/sellers`);
    if (c.flood) parts.push(`${c.flood} repost flood`);

    const bar = document.createElement("div");
    bar.className = "ibp-hidden-bar";
    bar.innerHTML =
      `🚫 iBay Plus hid ${total} listing${total === 1 ? "" : "s"} — ` +
      IBAY_PLUS.esc(parts.join(" · ")) +
      ` — <a href="#">show them</a>`;
    bar.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
      revealed = true;
      document.querySelectorAll(".ibp-hidden-row").forEach((r) =>
        r.classList.remove("ibp-hidden-row"));
      bar.remove();
    });
    // insert below the price bar (stable order: price bar, then hidden bar)
    const anchor = document.querySelector(".ibp-price-bar") || first;
    first.parentElement.insertBefore(bar, anchor);
  }

  function showToast(msg, undo) {
    document.querySelectorAll(".ibp-toast").forEach((el) => el.remove());
    const t = document.createElement("div");
    t.className = "ibp-toast";
    t.innerHTML = `${IBAY_PLUS.esc(msg)} <a href="#">Undo</a>`;
    t.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
      if (undo) undo();
      t.remove();
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  /* ---------- orchestration ---------- */

  function applyAll() {
    ctx.counts = { keyword: 0, spam: 0, flood: 0, price: 0 };
    ensurePriceBar();
    document.querySelectorAll(".latest-list-item").forEach((row) => decorate(row));
    applyFloodCap();
    renderBar();
    updatePriceBarCount();
  }

  let timer = null;
  function debouncedApply() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      let added = false;
      document.querySelectorAll(".latest-list-item:not(.ibp-card)").forEach((row) => {
        decorate(row);
        added = true;
      });
      if (added) applyAll();
    }, 300);
  }

  async function run() {
    const store = await IBAY_PLUS.load();
    settings = store.settings;
    watchlist = store.watchlist;

    applyAll();

    // late-added cards (site scripts, infinite lists)
    new MutationObserver(debouncedApply).observe(document.body, {
      childList: true, subtree: true,
    });

    // settings / watchlist changes from the popup
    chrome.storage.onChanged.addListener(async () => {
      const fresh = await IBAY_PLUS.load();
      settings = fresh.settings;
      watchlist = fresh.watchlist;
      applyAll();
    });
  }

  run();
})();
