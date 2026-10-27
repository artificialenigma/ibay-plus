/* iBay Plus — listing page enhancements:
   - watchlist heart button on every listing card
   - price filter: when a range is set, fetches ALL pages of the current
     feed (category or search results) and filters across the whole result
     set — not just page 1
   - spam removal: seller block button, heuristics (ALL-CAPS, phone spam,
     junk chars), optional flood cap
   - keyword hide/highlight
   - combined "hidden listings" bar with reveal
   - MutationObserver so late-added cards get decorated too */

(function () {
  "use strict";

  const MAX_PAGES = 20;
  const PAGE_DELAY_MS = 300;
  const CACHE_TTL_MS = 10 * 60 * 1000;

  let settings = null;
  let watchlist = null;
  let revealed = false;      // user clicked "show them" — don't re-hide until reload
  let jobId = 0;             // bump to cancel a running all-pages fetch
  let combined = null;       // { url, items: [{...}], pages, truncated } | null
  let sortMode = "feed";     // feed | asc | desc

  const ctx = { counts: { keyword: 0, spam: 0, flood: 0, price: 0 } };

  /* ---------- tiny helpers ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function safeUrl(href, base) {
    try { return new URL(href, base).href; } catch (e) { return null; }
  }

  function priceFilterOn() {
    const pf = settings.priceFilter || {};
    return pf.min != null || pf.max != null || !!pf.hideUnstated;
  }

  function listingRows() {
    return document.querySelectorAll(".latest-list-item");
  }

  /* ---------- extraction (works for live rows and parsed pages) ---------- */

  function extractItemFrom(row, baseUrl) {
    const link = row.querySelector("h5 a") || row.querySelector(".image a");
    if (!link) return null;
    const href = safeUrl(link.getAttribute("href"), baseUrl);
    const id = IBAY_PLUS.itemIdFromUrl(href);
    if (!id) return null;

    const img = row.querySelector(".image img");
    const thumb = img ? (img.getAttribute("data-src") || img.getAttribute("src")) : null;
    const sellerA = row.querySelector(".iw-by-seller a");
    const sellerHref = sellerA ? safeUrl(sellerA.getAttribute("href"), baseUrl) : null;
    const priceEl = row.querySelector(".price");

    return {
      id,
      url: href ? href.split("?")[0] : null,
      title: link.textContent.trim(),
      price: priceEl ? IBAY_PLUS.parsePrice(priceEl.textContent) : null,
      image: thumb,
      seller: sellerA ? sellerA.textContent.trim() : "",
      sellerId: sellerA ? IBAY_PLUS.sellerIdFromUrl(sellerA.getAttribute("href")) : null,
      sellerUrl: sellerHref,
    };
  }

  function extractItem(row) {
    return extractItemFrom(row, location.href);
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
      refreshAll();
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
    listingRows().forEach((row) => {
      const sellerA = row.querySelector(".iw-by-seller a");
      const sid = sellerA ? IBAY_PLUS.sellerIdFromUrl(sellerA.getAttribute("href")) : null;
      if (!sid) return;
      const n = (counts.get(sid) || 0) + 1;
      counts.set(sid, n);
      if (n > max && !revealed && !row.classList.contains("ibp-hidden-row")) {
        row.classList.add("ibp-hidden-row", "ibp-flood-row");
        ctx.counts.flood++;
      }
    });
  }

  /* ---------- price filter bar ---------- */

  function ensurePriceBar() {
    let bar = document.querySelector(".ibp-price-bar");
    if (bar) return bar;
    const rows = listingRows();
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
      <span class="ibp-pf-progress"></span>
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
        // refreshAll also fires via onChanged; jobId bump cancels any stale run
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

  function priceBarProgress(msg) {
    const bar = document.querySelector(".ibp-price-bar");
    if (!bar) return;
    bar.querySelector(".ibp-pf-progress").textContent = msg || "";
  }

  function updatePriceBarCount() {
    const bar = document.querySelector(".ibp-price-bar");
    if (!bar) return;
    const n = ctx.counts.price;
    bar.querySelector(".ibp-pf-count").textContent = n ? `${n} hidden` : "";
    bar.classList.toggle("ibp-pf-active", n > 0);
  }

  /* ---------- all-pages fetch ---------- */

  /** Normalize to the feed's first page: category `_N.html` -> `_0.html`,
      search `off=N` -> param removed. Crawl always starts here. */
  function baseFeedUrl() {
    const u = new URL(location.href);
    if (/_(\d+)\.html$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/_(\d+)\.html$/, "_0.html");
      return u.href;
    }
    u.searchParams.delete("off"); // search pagination
    return u.href;
  }

  /** Page-independent key so every page of the same feed shares one cache. */
  function cacheKey() {
    const u = new URL(location.href);
    const p = u.pathname.replace(/_(\d+)\.html$/, "_X.html");
    u.searchParams.delete("off");
    return "ibp:all:" + p + u.search;
  }

  function readCache() {
    try {
      const raw = sessionStorage.getItem(cacheKey());
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.t > CACHE_TTL_MS) return null;
      return data;
    } catch (e) { return null; }
  }

  function writeCache(data) {
    try { sessionStorage.setItem(cacheKey(), JSON.stringify(data)); } catch (e) { /* quota */ }
  }

  function nextPaginationUrl(doc, pageUrl) {
    const ul = doc.querySelector("ul.pagination");
    if (!ul) return null;
    // the "navigate_next" li holds the next page; fall back to nothing
    let nextHref = null;
    ul.querySelectorAll("li a").forEach((a) => {
      if (a.querySelector("i.material-icons") &&
          /navigate_next/.test(a.querySelector("i").textContent)) {
        nextHref = a.getAttribute("href");
      }
    });
    if (!nextHref) return null;
    const nextUrl = safeUrl(nextHref, pageUrl);
    if (!nextUrl) return null;

    // the last page's "next" loops back to page 1 — stop on that
    const pageNum = (u) => {
      const m = /(?:_(\d+)\.html|off=(\d+))/.exec(u);
      return m ? parseInt(m[1] || m[2], 10) : null;
    };
    const cur = pageNum(pageUrl), nxt = pageNum(nextUrl);
    if (cur != null && nxt != null && nxt <= cur) return null;
    return nextUrl;
  }

  async function fetchAllPages(startUrl, id, onProgress) {
    let url = startUrl;
    const items = [];
    const seen = new Set();
    let pages = 0;

    while (url && pages < MAX_PAGES) {
      if (id !== jobId) return null; // superseded
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      doc.querySelectorAll(".latest-list-item").forEach((row) => {
        const it = extractItemFrom(row, url);
        if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
      });

      pages++;
      if (onProgress) onProgress(pages, url);

      const next = nextPaginationUrl(doc, url);
      if (next === url) break;
      url = next;
      if (url) await sleep(PAGE_DELAY_MS);
    }
    return { items, pages, truncated: pages >= MAX_PAGES && !!url };
  }

  /* ---------- combined (all pages) rendering ---------- */

  function hideOriginals() {
    listingRows().forEach((row) => {
      row.classList.add("ibp-original-hidden");
      const nx = row.nextElementSibling;
      if (nx && nx.classList.contains("divider")) nx.classList.add("ibp-original-hidden");
    });
  }

  function unhideOriginals() {
    document.querySelectorAll(".ibp-original-hidden").forEach((el) =>
      el.classList.remove("ibp-original-hidden"));
  }

  function sortedItems(items) {
    const arr = items.slice();
    if (sortMode === "asc") arr.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    if (sortMode === "desc") arr.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
    return arr;
  }

  function buildResultRow(item) {
    const row = document.createElement("div");
    row.className = "bg-light latest-list-item";
    const priceText = item.price != null
      ? `<span class="currency">MVR</span> ${item.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
      : `<span class="currency">MVR</span> not stated`;
    row.innerHTML = `
      <div class="row" style="margin-bottom:0px;">
        <div class="col m3 s4">
          <div class="image">
            <a href="${IBAY_PLUS.esc(item.url)}">
              <img src="${IBAY_PLUS.esc(item.image || "")}" alt="" onerror="this.style.visibility='hidden'">
            </a>
          </div>
        </div>
        <div class="col m7 s8">
          <h5><a href="${IBAY_PLUS.esc(item.url)}">${IBAY_PLUS.esc(item.title)}</a></h5>
        </div>
        <div class="col m6 s8">
          <div class="iw-prod-by">
            <span class="iw-by-seller"><a href="${IBAY_PLUS.esc(item.sellerUrl || "#")}">${IBAY_PLUS.esc(item.seller)}</a></span>
          </div>
        </div>
        <div class="col m3">
          <div class="price">${priceText}</div>
        </div>
      </div>`;
    const div = document.createElement("div");
    div.className = "divider";
    const frag = document.createDocumentFragment();
    frag.appendChild(row);
    frag.appendChild(div);
    return frag;
  }

  /** On category pages, offer the site's own server-side price search
      (covers the whole category, not just the crawled pages). */
  function serverSearchLink() {
    const pf = settings.priceFilter || {};
    const cat = /-b(\d+)(?:_.*)?\.html$/.exec(location.pathname);
    if (!cat || (pf.min == null && pf.max == null)) return "";
    const q = new URLSearchParams({ page: "search", s_res: "AND", cid: cat[1] });
    if (pf.min != null) q.set("f_price_min", String(pf.min));
    if (pf.max != null) q.set("f_price_max", String(pf.max));
    return `&nbsp;·&nbsp; <a href="index.php?${IBAY_PLUS.esc(q.toString())}"
      title="Uses ibay's server-side price filter — covers every item in this category">
      search all items in this range</a>`;
  }

  function renderCombined(data) {
    hideOriginals();

    let sec = document.querySelector(".ibp-allpages");
    const rows = listingRows();
    if (!sec) {
      sec = document.createElement("div");
      sec.className = "ibp-allpages";
      const anchor = document.querySelector(".ibp-price-bar") || rows[0];
      anchor.parentElement.insertBefore(sec, anchor.nextSibling);
    }

    sec.innerHTML = "";
    const head = document.createElement("div");
    head.className = "ibp-allpages-head";
    const shown = sortedItems(data.items);
    head.innerHTML = `
      <b>${shown.length}</b> listings from <b>${data.pages}</b> page${data.pages === 1 ? "" : "s"}
      ${data.truncated ? " (capped at " + MAX_PAGES + " pages)" : ""}
      &nbsp;·&nbsp; sorted by
      <select class="ibp-sort">
        <option value="feed">feed order</option>
        <option value="asc">price ↑</option>
        <option value="desc">price ↓</option>
      </select>
      ${serverSearchLink()}
      &nbsp;·&nbsp; <a href="#" class="ibp-restore">show this page only</a>`;
    head.querySelector(".ibp-sort").value = sortMode;
    head.querySelector(".ibp-sort").addEventListener("change", (e) => {
      sortMode = e.target.value;
      renderCombined(data);
      applyAll();
    });
    head.querySelector(".ibp-restore").addEventListener("click", (e) => {
      e.preventDefault();
      restoreOriginal();
    });
    sec.appendChild(head);

    shown.forEach((item) => sec.appendChild(buildResultRow(item)));
  }

  function restoreOriginal() {
    jobId++; // cancel any running fetch
    combined = null;
    document.querySelectorAll(".ibp-allpages").forEach((el) => el.remove());
    priceBarProgress("");
    unhideOriginals();
    applyAll();
  }

  async function startCombined() {
    const rows = listingRows();
    if (!rows.length) return;

    const id = ++jobId;
    const cached = readCache();
    if (cached && cached.items && cached.items.length) {
      combined = cached;
      renderCombined(combined);
      applyAll();
      return;
    }

    priceBarProgress("fetching all pages…");
    hideOriginals();
    try {
      const data = await fetchAllPages(baseFeedUrl(), id,
        (pages) => priceBarProgress(`fetching page ${pages}…`));
      if (id !== jobId) return; // superseded mid-flight
      if (!data || !data.items.length) {
        // fallback: filter the current page only
        priceBarProgress("⚠ couldn't load all pages — filtering this page only");
        unhideOriginals();
        combined = null;
        applyAll();
        return;
      }
      priceBarProgress("");
      combined = { url: location.href, items: data.items, pages: data.pages, truncated: data.truncated };
      writeCache({ ...combined, t: Date.now() });
      renderCombined(combined);
      applyAll();
    } catch (err) {
      if (id !== jobId) return;
      priceBarProgress("⚠ " + err.message);
      unhideOriginals();
      combined = null;
      applyAll();
    }
  }

  /* ---------- hidden bar & toast ---------- */

  function renderBar() {
    document.querySelectorAll(".ibp-hidden-bar").forEach((el) => el.remove());
    const c = ctx.counts;
    const total = c.keyword + c.spam + c.flood;
    if (!total) return;

    const rows = listingRows();
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
    anchor.parentElement.insertBefore(bar, anchor);
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
    listingRows().forEach((row) => decorate(row));
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

  /** Central entry point: decide between combined mode and page-only mode. */
  async function refreshAll() {
    const store = await IBAY_PLUS.load();
    settings = store.settings;
    watchlist = store.watchlist;

    if (!listingRows().length) return; // not a listing page

    if (priceFilterOn()) {
      applyAll();          // filter page 1 immediately (fast feedback)
      startCombined();     // then upgrade to all-pages results
    } else {
      if (combined || document.querySelector(".ibp-allpages")) restoreOriginal();
      else applyAll();
    }
  }

  async function run() {
    // late-added cards (site scripts, infinite lists)
    new MutationObserver(debouncedApply).observe(document.body, {
      childList: true, subtree: true,
    });

    // settings / watchlist changes from the popup or the price bar
    chrome.storage.onChanged.addListener(() => refreshAll());

    await refreshAll();
  }

  run();
})();
