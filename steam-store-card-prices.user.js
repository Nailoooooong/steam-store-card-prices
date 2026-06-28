// ==UserScript==
// @name         Steam Store Card Prices
// @namespace    local.steam.store.card.prices
// @version      0.6.4
// @description  在 Steam 商店游戏详情页显示该游戏集换式卡牌的社区市场价格。
// @author       Codex
// @license      MIT
// @match        https://store.steampowered.com/app/*
// @match        https://store.steampowered.com/agecheck/app/*
// @connect      steamcommunity.com
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const APP_ID = readAppId();
  const PANEL_ID = "sscp-panel";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const SETTINGS_KEY = "sscp-settings-v2";
  const MARKET_SEARCH_API = "https://steamcommunity.com/market/search/render/";
  const MARKET_SEARCH_PAGE = "https://steamcommunity.com/market/search";
  const MARKET_LISTING_PAGE = "https://steamcommunity.com/market/listings/753/";
  const STEAM_TRANSACTION_FEE_PERCENT = 0.05;
  const DEFAULT_PUBLISHER_FEE_PERCENT = 0.10;
  const CURRENCY_CODES_TO_ROUND = [
    "JPY",
    "IDR",
    "UAH",
    "CLP",
    "COP",
    "TWD",
    "KZT",
    "CRC",
    "UYU",
    "KRW",
    "VND",
  ];

  const DEFAULT_SETTINGS = {
    queryRegularCards: true,
    queryFoilCards: true,
    queryRegularBuyOrders: true,
    queryFoilBuyOrders: true,
    showRegularCards: true,
    showFoilCards: true,
    showSellPrice: true,
    showNetPrice: true,
    showBuyPrice: true,
    panelPosition: "right",
    panelWidth: 300,
    panelHeight: 620,
  };

  if (!APP_ID || document.getElementById(PANEL_ID)) return;

  injectStyle();

  const state = {
    settings: loadSettings(),
    data: null,
    fromCache: false,
    refreshSeq: 0,
  };
  const panel = createPanel(APP_ID, state);
  applyPanelSize(panel, state.settings);
  mountPanel(panel, state.settings.panelPosition, state.settings);

  const cached = readCache(APP_ID, state.settings);
  if (cached) {
    state.data = cached;
    state.fromCache = true;
    renderData(panel, cached, true, state.settings);
  } else {
    renderLoading(panel, "正在读取社区市场卡牌价格...");
  }

  refresh(APP_ID, panel, state, false);

  function readAppId() {
    const match = window.location.pathname.match(/\/(?:app|agecheck\/app)\/(\d+)/);
    return match ? match[1] : "";
  }

  function createPanel(appid, appState) {
    const el = document.createElement("section");
    el.id = PANEL_ID;
    el.innerHTML = `
      <div class="sscp-head">
        <div>
          <div class="sscp-title">集换式卡牌价格</div>
          <div class="sscp-subtitle">App ${escapeHtml(appid)} · Steam 社区市场</div>
        </div>
        <div class="sscp-actions">
          <a class="sscp-market-link" href="${escapeAttr(buildMarketPageUrl(appid))}" target="_blank" rel="noopener">市场</a>
          <button class="sscp-refresh" type="button" title="刷新价格" aria-label="刷新价格">刷新</button>
        </div>
      </div>
      ${renderSettings(appState.settings)}
      <div class="sscp-body"></div>
    `;

    el.querySelector(".sscp-refresh").addEventListener("click", () => refresh(appid, el, appState, true));
    bindSettings(el, appid, appState);
    return el;
  }

  function renderSettings(settings) {
    return `
      <details class="sscp-settings">
        <summary>设置</summary>
        <div class="sscp-settings-grid">
          <div class="sscp-settings-group">
            <div class="sscp-settings-title">查询</div>
            ${renderCheckbox("queryRegularCards", "普通卡", settings.queryRegularCards)}
            ${renderCheckbox("queryFoilCards", "闪卡", settings.queryFoilCards)}
            ${renderCheckbox("queryRegularBuyOrders", "普通卡求购价", settings.queryRegularBuyOrders)}
            ${renderCheckbox("queryFoilBuyOrders", "闪卡求购价", settings.queryFoilBuyOrders)}
          </div>
          <div class="sscp-settings-group">
            <div class="sscp-settings-title">显示</div>
            ${renderCheckbox("showRegularCards", "普通卡", settings.showRegularCards)}
            ${renderCheckbox("showFoilCards", "闪卡", settings.showFoilCards)}
            ${renderCheckbox("showSellPrice", "出售价", settings.showSellPrice)}
            ${renderCheckbox("showNetPrice", "到手价", settings.showNetPrice)}
            ${renderCheckbox("showBuyPrice", "求购价", settings.showBuyPrice)}
          </div>
          <div class="sscp-settings-group">
            <div class="sscp-settings-title">面板</div>
            ${renderPositionSelect(settings.panelPosition)}
            ${renderNumberInput("panelWidth", "宽度", settings.panelWidth, 240, 520)}
            ${renderNumberInput("panelHeight", "高度", settings.panelHeight, 280, 900)}
          </div>
        </div>
      </details>
    `;
  }

  function renderCheckbox(key, label, checked) {
    return `
      <label class="sscp-toggle">
        <input type="checkbox" data-sscp-setting="${escapeAttr(key)}" ${checked ? "checked" : ""}>
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }

  function renderNumberInput(key, label, value, min, max) {
    return `
      <label class="sscp-number-row">
        <span>${escapeHtml(label)}</span>
        <input
          type="number"
          data-sscp-setting="${escapeAttr(key)}"
          min="${escapeAttr(min)}"
          max="${escapeAttr(max)}"
          step="10"
          value="${escapeAttr(value)}"
        >
      </label>
    `;
  }

  function renderPositionSelect(value) {
    return `
      <label class="sscp-select-row">
        <span>位置</span>
        <select data-sscp-setting="panelPosition">
          ${renderPositionOption("right", "右侧悬浮", value)}
          ${renderPositionOption("left", "左侧悬浮", value)}
          ${renderPositionOption("inline", "页面内", value)}
        </select>
      </label>
    `;
  }

  function renderPositionOption(value, label, selectedValue) {
    return `<option value="${escapeAttr(value)}" ${selectedValue === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function bindSettings(panel, appid, appState) {
    panel.addEventListener("change", event => {
      const input = event.target.closest("[data-sscp-setting]");
      if (!input) return;

      const key = input.getAttribute("data-sscp-setting");
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return;

      appState.settings = {
        ...appState.settings,
        [key]: readSettingControlValue(input, key),
      };
      saveSettings(appState.settings);

      if (key === "panelPosition") {
        mountPanel(panel, appState.settings.panelPosition, appState.settings);
        return;
      }

      if (isPanelSizeSetting(key)) {
        applyPanelSize(panel, appState.settings);
        return;
      }

      if (isQuerySetting(key)) {
        refresh(appid, panel, appState, true);
      } else if (appState.data) {
        renderData(panel, appState.data, appState.fromCache, appState.settings);
      } else {
        renderLoading(panel, "显示设置已更新，等待价格数据...");
      }
    });
  }

  function isQuerySetting(key) {
    return key.startsWith("query");
  }

  function readSettingControlValue(input, key) {
    if (key === "panelPosition") return normalizePanelPosition(input.value);
    if (isPanelSizeSetting(key)) return normalizePanelSize(key, input.value);
    return Boolean(input.checked);
  }

  function isPanelSizeSetting(key) {
    return key === "panelWidth" || key === "panelHeight";
  }

  function applyPanelSize(panel, settings) {
    panel.style.setProperty("--sscp-panel-width", `${normalizePanelSize("panelWidth", settings.panelWidth)}px`);
    panel.style.setProperty("--sscp-panel-height", `${normalizePanelSize("panelHeight", settings.panelHeight)}px`);
  }

  function mountPanel(panel, position, settings) {
    const panelPosition = normalizePanelPosition(position);
    applyPanelSize(panel, settings);
    panel.classList.remove("sscp-floating", "sscp-floating-left", "sscp-floating-right");

    if (panelPosition === "left" || panelPosition === "right") {
      document.body.appendChild(panel);
      panel.classList.add("sscp-floating", `sscp-floating-${panelPosition}`);
      return;
    }

    const rightCol = document.querySelector("#game_highlights .rightcol")
      || document.querySelector(".rightcol.game_meta_data")
      || document.querySelector(".rightcol")
      || null;

    if (rightCol) {
      const headerImage = rightCol.querySelector(".game_header_image_full");
      if (headerImage && headerImage.parentElement === rightCol) {
        headerImage.insertAdjacentElement("afterend", panel);
      } else {
        rightCol.prepend(panel);
      }
      return;
    }

    const purchaseArea = document.querySelector("#game_area_purchase");
    if (purchaseArea) {
      purchaseArea.insertAdjacentElement("beforebegin", panel);
      return;
    }

    document.body.appendChild(panel);
    panel.classList.add("sscp-floating", "sscp-floating-right");
  }

  async function refresh(appid, panel, appState, force) {
    const seq = ++appState.refreshSeq;
    const settings = appState.settings;
    const button = panel.querySelector(".sscp-refresh");
    button.disabled = true;
    if (force) renderLoading(panel, "正在刷新社区市场价格...");

    try {
      if (!force) {
        const cached = readCache(appid, settings);
        if (cached) {
          appState.data = cached;
          appState.fromCache = true;
          renderData(panel, cached, true, settings);
          return;
        }
      }

      const data = await fetchData(appid, settings);
      if (seq !== appState.refreshSeq) return;

      appState.data = data;
      appState.fromCache = false;
      writeCache(appid, settings, data);
      renderData(panel, data, false, settings);
    } catch (error) {
      if (seq === appState.refreshSeq) {
        renderError(panel, error);
      }
    } finally {
      if (seq === appState.refreshSeq) {
        button.disabled = false;
      }
    }
  }

  async function fetchData(appid, settings) {
    const data = {
      appid,
      updatedAt: Date.now(),
      regular: createGroup(false),
      foil: createGroup(false),
    };

    const tasks = [];
    if (settings.queryRegularCards) {
      tasks.push(fetchCardGroup(appid, false, settings.queryRegularBuyOrders).then(group => {
        data.regular = group;
      }));
    }
    if (settings.queryFoilCards) {
      tasks.push(fetchCardGroup(appid, true, settings.queryFoilBuyOrders).then(group => {
        data.foil = group;
      }));
    }

    await Promise.all(tasks);
    return data;
  }

  function createGroup(queried) {
    return {
      queried,
      buyQueried: false,
      cards: [],
    };
  }

  async function fetchCardGroup(appid, foil, includeBuyOrders) {
    const cards = [];
    let total = Infinity;
    let start = 0;
    const count = 100;

    while (start < total && cards.length < 300) {
      const url = buildMarketApiUrl(appid, foil, start, count);
      const data = await getJson(url);
      if (data && data.success === false) {
        throw new Error("Steam 市场返回失败状态");
      }

      const results = Array.isArray(data?.results) ? data.results : [];
      total = Number.isFinite(Number(data?.total_count)) ? Number(data.total_count) : results.length;
      cards.push(...results.map(item => normalizeCard(item, foil)).filter(Boolean));

      if (results.length < count) break;
      start += count;
    }

    const group = createGroup(true);
    group.cards = uniqueBy(cards, card => card.hashName).sort((a, b) => (
      stripFoilSuffix(a.name).localeCompare(stripFoilSuffix(b.name), undefined, { numeric: true })
    ));

    if (includeBuyOrders && group.cards.length) {
      group.buyQueried = true;
      group.cards = await mapLimit(group.cards, 3, async card => enrichBuyOrder(card));
    }

    return group;
  }

  async function enrichBuyOrder(card) {
    try {
      const html = await getText(card.marketUrl);
      const order = parseBuyOrderHtml(html);
      const publisherFeePercent = parsePublisherFeePercent(html) ?? card.publisherFeePercent;
      return {
        ...card,
        publisherFeePercent,
        netPrice: calculateSellerReceives(card.sellPrice, publisherFeePercent, card.minimumFee),
        buyPrice: order.buyPrice,
        buyOrderCount: order.buyOrderCount,
        buyPriceError: false,
      };
    } catch (_) {
      return {
        ...card,
        buyPrice: null,
        buyOrderCount: 0,
        buyPriceError: true,
      };
    }
  }

  function parsePublisherFeePercent(html) {
    const normalized = String(html || "").replace(/\\/g, "");
    const match = normalized.match(/"publisherFeePct"\s*:\s*([0-9.]+)/);
    if (!match) return null;

    const value = Number(match[1]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function parseBuyOrderHtml(html) {
    const normalized = String(html || "").replace(/\\/g, "");
    const buyPrice = readNumber(normalized, /"amtMaxBuyOrder"\s*:\s*(\d+)/);
    const buyOrderCount = readNumber(normalized, /"cBuyOrders"\s*:\s*(\d+)/);

    if (buyPrice == null && buyOrderCount == null) {
      throw new Error("未找到求购订单数据");
    }

    return {
      buyPrice: buyPrice || 0,
      buyOrderCount: buyOrderCount || 0,
    };
  }

  function readNumber(text, pattern) {
    const match = String(text || "").match(pattern);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function buildMarketApiUrl(appid, foil, start, count) {
    const params = new URLSearchParams();
    params.set("query", "");
    params.set("start", String(start));
    params.set("count", String(count));
    params.set("search_descriptions", "0");
    params.set("sort_column", "name");
    params.set("sort_dir", "asc");
    params.set("appid", "753");
    params.set("norender", "1");
    params.append("category_753_Game[]", `tag_app_${appid}`);
    params.append("category_753_item_class[]", "tag_item_class_2");
    params.append("category_753_cardborder[]", foil ? "tag_cardborder_1" : "tag_cardborder_0");
    return `${MARKET_SEARCH_API}?${params.toString()}`;
  }

  function buildMarketPageUrl(appid, foil) {
    const params = new URLSearchParams();
    params.set("appid", "753");
    params.append("category_753_Game[]", `tag_app_${appid}`);
    params.append("category_753_item_class[]", "tag_item_class_2");
    if (typeof foil === "boolean") {
      params.append("category_753_cardborder[]", foil ? "tag_cardborder_1" : "tag_cardborder_0");
    }
    return `${MARKET_SEARCH_PAGE}?${params.toString()}`;
  }

  function normalizeCard(item, foil) {
    const desc = item?.asset_description || {};
    const hashName = String(item?.hash_name || desc.market_hash_name || "").trim();
    if (!hashName) return null;

    const iconPath = desc.icon_url_large || desc.icon_url || "";
    const iconUrl = iconPath ? `https://community.fastly.steamstatic.com/economy/image/${iconPath}/64fx64f` : "";
    const sellPrice = Number.isFinite(Number(item.sell_price)) ? Number(item.sell_price) : null;
    const publisherFeePercent = readPublisherFeeFromItem(item);
    const priceFormat = inferPriceFormat(sellPrice, String(item.sell_price_text || item.sale_price_text || ""));

    return {
      foil,
      name: String(item.name || desc.market_name || desc.name || hashName).trim(),
      hashName,
      classId: String(desc.classid || "").trim(),
      type: String(desc.type || "").trim(),
      listings: parseInt(item.sell_listings, 10) || 0,
      sellPrice,
      netPrice: calculateSellerReceives(sellPrice, publisherFeePercent, priceFormat.minimumFee),
      publisherFeePercent,
      priceUnit: priceFormat.unit,
      minimumFee: priceFormat.minimumFee,
      sellPriceText: String(item.sell_price_text || "").trim(),
      salePriceText: String(item.sale_price_text || "").trim(),
      buyPrice: null,
      buyOrderCount: 0,
      buyPriceError: false,
      iconUrl,
      marketUrl: `${MARKET_LISTING_PAGE}${encodeURIComponent(hashName)}`,
    };
  }

  function renderLoading(panel, text) {
    panel.querySelector(".sscp-body").innerHTML = `
      <div class="sscp-state">
        <span class="sscp-spinner"></span>
        <span>${escapeHtml(text)}</span>
      </div>
    `;
  }

  function renderError(panel, error) {
    panel.querySelector(".sscp-body").innerHTML = `
      <div class="sscp-error">
        <div class="sscp-error-title">读取失败</div>
        <div>${escapeHtml(error?.message || "无法读取 Steam 社区市场。")}</div>
      </div>
    `;
  }

  function renderData(panel, data, fromCache, settings) {
    const regular = normalizeGroup(data.regular);
    const foil = normalizeGroup(data.foil);
    const visibleGroups = [
      settings.showRegularCards ? { key: "regular", label: "普通卡", group: regular, marketUrl: buildMarketPageUrl(data.appid, false) } : null,
      settings.showFoilCards ? { key: "foil", label: "闪卡", group: foil, marketUrl: buildMarketPageUrl(data.appid, true) } : null,
    ].filter(Boolean);
    const anyQueried = Boolean(regular.queried || foil.queried);
    const updated = data.updatedAt ? formatTime(data.updatedAt) : "";

    if (!settings.showRegularCards && !settings.showFoilCards) {
      panel.querySelector(".sscp-body").innerHTML = `
        <div class="sscp-empty">
          <div>当前没有开启任何卡牌显示。</div>
          <div class="sscp-muted">可以在设置里打开普通卡或闪卡显示。</div>
        </div>
      `;
      return;
    }

    if (!anyQueried) {
      panel.querySelector(".sscp-body").innerHTML = `
        <div class="sscp-empty">
          <div>当前没有开启任何卡牌查询。</div>
          <div class="sscp-muted">显示开关和查询开关相互独立；请在设置里打开需要查询的类型。</div>
        </div>
      `;
      return;
    }

    const queriedCardCount = regular.cards.length + foil.cards.length;
    if (!queriedCardCount && visibleGroups.every(item => item.group.queried)) {
      panel.querySelector(".sscp-body").innerHTML = `
        <div class="sscp-empty">
          <div>没有找到可交易的集换式卡牌。</div>
          <div class="sscp-muted">可能是该游戏没有卡牌，或当前社区市场暂时没有对应结果。</div>
        </div>
      `;
      return;
    }

    panel.querySelector(".sscp-body").innerHTML = `
      <div class="sscp-summary-grid">
        ${visibleGroups.map(item => renderSummaryCard(item.label, item.group, item.marketUrl, settings)).join("")}
      </div>
      <div class="sscp-updated">${fromCache ? "缓存" : "更新"}于 ${escapeHtml(updated)}</div>
      ${visibleGroups.map(item => renderCardSection(item.label, item.group, settings)).join("")}
    `;
  }

  function normalizeGroup(group) {
    return {
      queried: Boolean(group?.queried),
      buyQueried: Boolean(group?.buyQueried),
      cards: Array.isArray(group?.cards) ? group.cards : [],
    };
  }

  function renderSummaryCard(label, group, marketUrl, settings) {
    const cards = group.cards;
    const sellSummary = summarizePrices(cards, "sellPrice", card => card.sellPriceText || card.salePriceText || "");
    const netSummary = summarizePrices(cards, "netPrice", card => card.sellPriceText || card.salePriceText || "");
    const buySummary = group.buyQueried
      ? summarizePrices(cards, "buyPrice", card => card.sellPriceText || card.salePriceText || "")
      : { text: group.queried && cards.length ? "未查询" : "无结果", complete: false };
    const primary = settings.showSellPrice
      ? sellSummary.text
      : settings.showNetPrice ? netSummary.text : settings.showBuyPrice ? buySummary.text : `${cards.length} 张`;
    const minListings = cards.length
      ? Math.min(...cards.map(card => card.listings).filter(count => Number.isFinite(count)))
      : 0;
    const maxBuyOrders = group.buyQueried && cards.length
      ? Math.max(...cards.map(card => card.buyOrderCount || 0))
      : 0;

    return `
      <a class="sscp-summary-card" href="${escapeAttr(marketUrl)}" target="_blank" rel="noopener">
        <span class="sscp-summary-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(group.queried ? primary : "未查询")}</strong>
        <span>${escapeHtml(renderSummaryMeta(group, minListings, maxBuyOrders, settings))}</span>
        ${settings.showSellPrice ? `<span>出售合计 ${escapeHtml(group.queried ? sellSummary.text : "未查询")}</span>` : ""}
        ${settings.showNetPrice ? `<span>到手合计 ${escapeHtml(group.queried ? netSummary.text : "未查询")}</span>` : ""}
        ${settings.showBuyPrice ? `<span>求购合计 ${escapeHtml(group.buyQueried ? buySummary.text : "未查询")}</span>` : ""}
      </a>
    `;
  }

  function renderSummaryMeta(group, minListings, maxBuyOrders, settings) {
    if (!group.queried) return "查询已关闭";
    if (!group.cards.length) return "无结果";
    const parts = [`${group.cards.length} 张`];
    if (settings.showSellPrice) parts.push(`最少 ${minListings} 个出售`);
    if (settings.showBuyPrice && group.buyQueried) parts.push(`最多 ${maxBuyOrders} 个求购`);
    return parts.join(" · ");
  }

  function summarizePrices(cards, field, sampleFn) {
    if (!cards.length) return { text: "无结果", complete: false };
    const values = cards.map(card => card[field]);
    const complete = values.every(value => Number.isFinite(value));
    if (!complete) return { text: "价格不完整", complete: false };

    const total = values.reduce((sum, value) => sum + value, 0);
    if (field === "buyPrice" && total <= 0) return { text: "无求购", complete: true };

    const sample = cards.map(sampleFn).find(Boolean) || "";
    return {
      text: formatLikeSteam(total, sample, getGroupPriceUnit(cards)),
      complete: true,
    };
  }

  function renderCardSection(label, group, settings) {
    if (!group.queried) {
      return `
        <details class="sscp-section" open>
          <summary>${escapeHtml(label)}明细</summary>
          <div class="sscp-section-empty">当前未查询${escapeHtml(label)}。</div>
        </details>
      `;
    }

    if (!group.cards.length) {
      return `
        <details class="sscp-section" open>
          <summary>${escapeHtml(label)}明细</summary>
          <div class="sscp-section-empty">没有找到${escapeHtml(label)}结果。</div>
        </details>
      `;
    }

    return `
      <details class="sscp-section" open>
        <summary>${escapeHtml(label)}明细</summary>
        <div class="sscp-list">
          ${group.cards.map(card => renderCardRow(card, group, settings)).join("")}
        </div>
      </details>
    `;
  }

  function renderCardRow(card, group, settings) {
    const icon = card.iconUrl
      ? `<img class="sscp-icon" src="${escapeAttr(card.iconUrl)}" alt="">`
      : `<span class="sscp-icon sscp-icon-empty"></span>`;
    const meta = renderCardMeta(card, group, settings);
    const prices = renderCardPrices(card, group, settings);

    return `
      <a class="sscp-row" href="${escapeAttr(card.marketUrl)}" target="_blank" rel="noopener" title="${escapeAttr(card.hashName)}">
        ${icon}
        <span class="sscp-card-main">
          <span class="sscp-card-name">${escapeHtml(card.name)}</span>
          <span class="sscp-card-meta">${escapeHtml(meta)}</span>
        </span>
        ${prices}
      </a>
    `;
  }

  function renderCardMeta(card, group, settings) {
    const parts = [];
    if (settings.showSellPrice) parts.push(`${card.listings} 个出售`);
    if (settings.showBuyPrice) {
      parts.push(group.buyQueried ? `${card.buyOrderCount || 0} 个求购` : "求购未查询");
    }
    if (!parts.length) parts.push(card.type || card.hashName);
    return parts.join(" · ");
  }

  function renderCardPrices(card, group, settings) {
    const rows = [];
    if (settings.showSellPrice) {
      rows.push(`<span><em>卖</em><strong class="sscp-price sscp-sell-price">${escapeHtml(card.sellPriceText || card.salePriceText || "无报价")}</strong></span>`);
    }
    if (settings.showNetPrice) {
      rows.push(`<span><em>到</em><strong class="sscp-price sscp-net-price">${escapeHtml(renderNetPrice(card))}</strong></span>`);
    }
    if (settings.showBuyPrice) {
      rows.push(`<span><em>求</em><strong class="sscp-price sscp-buy-price">${escapeHtml(renderBuyPrice(card, group))}</strong></span>`);
    }
    if (!rows.length) return "";
    return `<span class="sscp-price-box">${rows.join("")}</span>`;
  }

  function renderNetPrice(card) {
    if (!Number.isFinite(card.netPrice)) return "无报价";
    return formatLikeSteam(card.netPrice, card.sellPriceText || card.salePriceText || "", card.priceUnit);
  }

  function renderBuyPrice(card, group) {
    if (!group.buyQueried) return "未查询";
    if (card.buyPriceError) return "失败";
    if (!Number.isFinite(card.buyPrice)) return "无数据";
    if (card.buyPrice <= 0) return "无求购";
    return formatLikeSteam(card.buyPrice, card.sellPriceText || card.salePriceText || "", card.priceUnit);
  }

  function getJson(url) {
    return requestText(url).then(text => {
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error("Steam 市场返回了无法解析的数据");
      }
    });
  }

  function getText(url) {
    return requestText(url);
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      const request = typeof GM_xmlhttpRequest === "function"
        ? GM_xmlhttpRequest
        : (typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function" ? GM.xmlHttpRequest : null);

      if (!request) {
        reject(new Error("当前脚本管理器不支持 GM_xmlhttpRequest"));
        return;
      }

      request({
        method: "GET",
        url,
        headers: {
          "Accept": "application/json,text/html,text/plain,*/*",
        },
        timeout: 25000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`Steam 市场请求失败: HTTP ${response.status}`));
            return;
          }
          resolve(response.responseText || "");
        },
        onerror() {
          reject(new Error("Steam 市场网络请求失败"));
        },
        ontimeout() {
          reject(new Error("Steam 市场请求超时"));
        },
      });
    });
  }

  async function mapLimit(items, limit, mapper) {
    const result = new Array(items.length);
    let index = 0;

    async function worker() {
      while (index < items.length) {
        const current = index++;
        result[current] = await mapper(items[current], current);
      }
    }

    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return result;
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
      return Object.fromEntries(
        Object.entries(DEFAULT_SETTINGS).map(([key, defaultValue]) => {
          if (key === "panelPosition") return [key, normalizePanelPosition(saved[key])];
          if (key === "panelWidth" || key === "panelHeight") return [key, normalizePanelSize(key, saved[key])];
          return [key, typeof saved[key] === "boolean" ? saved[key] : defaultValue];
        })
      );
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function normalizePanelPosition(value) {
    return ["left", "right", "inline"].includes(value) ? value : DEFAULT_SETTINGS.panelPosition;
  }

  function normalizePanelSize(key, value) {
    const rules = {
      panelWidth: { min: 240, max: 520 },
      panelHeight: { min: 280, max: 900 },
    };
    const rule = rules[key];
    if (!rule) return value;

    const number = Math.round(Number(value) || DEFAULT_SETTINGS[key]);
    return Math.min(rule.max, Math.max(rule.min, number));
  }

  function saveSettings(settings) {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {}
  }

  function readCache(appid, settings) {
    try {
      const raw = window.localStorage.getItem(cacheKey(appid, settings));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.updatedAt || Date.now() - data.updatedAt > CACHE_TTL_MS) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function writeCache(appid, settings, data) {
    try {
      window.localStorage.setItem(cacheKey(appid, settings), JSON.stringify(data));
    } catch (_) {}
  }

  function cacheKey(appid, settings) {
    return `sscp-cache-v5:${appid}:${querySignature(settings)}`;
  }

  function querySignature(settings) {
    return [
      settings.queryRegularCards ? "r1" : "r0",
      settings.queryFoilCards ? "f1" : "f0",
      settings.queryRegularBuyOrders ? "rb1" : "rb0",
      settings.queryFoilBuyOrders ? "fb1" : "fb0",
    ].join(":");
  }

  function uniqueBy(items, keyFn) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function stripFoilSuffix(name) {
    return String(name || "").replace(/\s*\(Foil\)\s*$/i, "");
  }

  function readPublisherFeeFromItem(item) {
    const desc = item?.asset_description || {};
    const raw = item?.market_fee ?? desc.market_fee;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0
      ? value
      : getWalletInfo().wallet_publisher_fee_percent_default;
  }

  function calculateSellerReceives(buyerPaysCents, publisherFeePercent = DEFAULT_PUBLISHER_FEE_PERCENT, minimumFee) {
    const amount = Math.round(Number(buyerPaysCents));
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const feeInfo = calculateFeeAmount(amount, publisherFeePercent, getWalletInfo(minimumFee));
    return amount > feeInfo.fees ? amount - feeInfo.fees : 1;
  }

  function calculateFeeAmount(amount, publisherFee, walletInfo) {
    publisherFee = publisherFee == null ? 0 : publisherFee;

    let iterations = 0;
    let estimatedReceived = parseInt(
      (amount - parseInt(walletInfo.wallet_fee_base, 10)) /
      (parseFloat(walletInfo.wallet_fee_percent) + parseFloat(publisherFee) + 1),
      10
    );
    if (!Number.isFinite(estimatedReceived)) estimatedReceived = amount;
    estimatedReceived = Math.max(1, estimatedReceived);

    let everUndershot = false;
    let fees = calculateAmountToSendForDesiredReceivedAmount(estimatedReceived, publisherFee, walletInfo);

    while (fees.amount !== amount && iterations < 10) {
      if (fees.amount > amount) {
        if (everUndershot) {
          fees = calculateAmountToSendForDesiredReceivedAmount(estimatedReceived - 1, publisherFee, walletInfo);
          fees.steam_fee += amount - fees.amount;
          fees.fees += amount - fees.amount;
          fees.amount = amount;
          break;
        }
        estimatedReceived--;
      } else {
        everUndershot = true;
        estimatedReceived++;
      }

      estimatedReceived = Math.max(1, estimatedReceived);
      fees = calculateAmountToSendForDesiredReceivedAmount(estimatedReceived, publisherFee, walletInfo);
      iterations++;
    }

    return fees;
  }

  function calculateAmountToSendForDesiredReceivedAmount(receivedAmount, publisherFee, walletInfo) {
    const roundFee = shouldRoundFees(walletInfo) ? Math.round : Math.floor;
    const minFee = Number(walletInfo.wallet_fee_minimum) || 1;
    publisherFee = publisherFee == null ? 0 : publisherFee;

    const steamFee = Math.max(
      parseInt(roundFee(receivedAmount * parseFloat(walletInfo.wallet_fee_percent) + parseInt(walletInfo.wallet_fee_base, 10)), 10),
      minFee
    );
    const publisherFeeAmount = publisherFee > 0
      ? Math.max(parseInt(roundFee(receivedAmount * publisherFee), 10), minFee)
      : 0;
    const amountToSend = receivedAmount + steamFee + publisherFeeAmount;

    return {
      steam_fee: steamFee,
      publisher_fee: publisherFeeAmount,
      fees: steamFee + publisherFeeAmount,
      amount: parseInt(amountToSend, 10),
    };
  }

  function getWalletInfo(minimumFee) {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const raw = pageWindow?.g_rgWalletInfo || {};
    return {
      wallet_fee_base: Number(raw.wallet_fee_base ?? 0),
      wallet_fee_percent: Number(raw.wallet_fee_percent ?? STEAM_TRANSACTION_FEE_PERCENT),
      wallet_fee_minimum: Number(raw.wallet_fee_minimum ?? minimumFee ?? 1),
      wallet_publisher_fee_percent_default: Number(raw.wallet_publisher_fee_percent_default ?? DEFAULT_PUBLISHER_FEE_PERCENT),
      wallet_currency: raw.wallet_currency,
      wallet_country: raw.wallet_country || "US",
    };
  }

  function shouldRoundFees(walletInfo) {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const currencyCode = getCurrencyCode(walletInfo);
    return CURRENCY_CODES_TO_ROUND.includes(currencyCode);
  }

  function inferPriceFormat(rawAmount, sampleText) {
    const fallback = { unit: 100, decimals: 2, minimumFee: 1 };
    const amount = Number(rawAmount);
    const parsed = parsePriceTextNumber(sampleText);
    if (!Number.isFinite(amount) || amount <= 0 || !parsed || parsed.value <= 0) return fallback;

    const ratio = amount / parsed.value;
    const unit = nearestUnit(ratio);
    const decimals = parsed.decimals;
    const minimumFee = decimals === 0 ? unit : 1;
    return { unit, decimals, minimumFee };
  }

  function parsePriceTextNumber(text) {
    const match = String(text || "").match(/[\d\s.,]+/);
    if (!match) return null;

    const raw = match[0].trim().replace(/\s/g, "");
    if (!raw) return null;

    const info = readSampleDecimalInfo(raw);
    const normalized = info.decimals > 0
      ? raw.replace(new RegExp(`\\${info.separator}(?=[^${info.separator}]*$)`), ".").replace(/[,\s]/g, "")
      : raw.replace(/[.,\s]/g, "");
    const value = Number(normalized);
    return Number.isFinite(value)
      ? { value, decimals: info.decimals }
      : null;
  }

  function nearestUnit(ratio) {
    const candidates = [1, 10, 100, 1000, 10000];
    return candidates.reduce((best, current) => (
      Math.abs(current - ratio) < Math.abs(best - ratio) ? current : best
    ), 1);
  }

  function getGroupPriceUnit(cards) {
    return cards.find(card => Number.isFinite(card.priceUnit) && card.priceUnit > 0)?.priceUnit || 100;
  }

  function formatLikeSteam(cents, sampleText, unit = 100) {
    if (!Number.isFinite(cents)) return "价格不完整";
    const steamFormatted = formatWithSteamCurrency(cents);
    if (steamFormatted) return steamFormatted;

    return formatBySampleText(cents, sampleText, unit);
  }

  function formatWithSteamCurrency(cents) {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const walletInfo = getWalletInfo();
    const currencyCode = getCurrencyCode(walletInfo);

    if (typeof pageWindow?.v_currencyformat !== "function" || !currencyCode) return "";

    try {
      return pageWindow.v_currencyformat(
        Math.round(cents),
        currencyCode,
        walletInfo.wallet_country || "US"
      );
    } catch (_) {
      return "";
    }
  }

  function getCurrencyCode(walletInfo) {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    if (typeof pageWindow?.GetCurrencyCode !== "function" || walletInfo.wallet_currency == null) {
      return "";
    }

    try {
      return pageWindow.GetCurrencyCode(walletInfo.wallet_currency);
    } catch (_) {
      return "";
    }
  }

  function formatBySampleText(cents, sampleText, unit = 100) {
    const divisor = Number.isFinite(unit) && unit > 0 ? unit : 100;
    const fallback = (cents / divisor).toFixed(2);
    if (!sampleText) return fallback;

    const numberMatch = sampleText.match(/[\d\s.,]+/);
    if (!numberMatch) return fallback;

    const originalNumber = numberMatch[0];
    const decimalInfo = readSampleDecimalInfo(originalNumber);
    const amount = cents / divisor;
    const localizedAmount = decimalInfo.decimals === 0
      ? String(Math.round(amount))
      : amount.toFixed(decimalInfo.decimals).replace(".", decimalInfo.separator);
    const leadingSpace = originalNumber.match(/^\s*/)?.[0] || "";
    const trailingSpace = originalNumber.match(/\s*$/)?.[0] || "";

    return sampleText.replace(originalNumber, `${leadingSpace}${localizedAmount}${trailingSpace}`);
  }

  function readSampleDecimalInfo(numberText) {
    const text = String(numberText || "").trim();
    const dotIndex = text.lastIndexOf(".");
    const commaIndex = text.lastIndexOf(",");
    const index = Math.max(dotIndex, commaIndex);

    if (index === -1) {
      return { decimals: 0, separator: "." };
    }

    const tail = text.slice(index + 1).replace(/\s/g, "");
    const looksDecimal = /^\d{1,2}$/.test(tail);
    if (!looksDecimal) {
      return { decimals: 0, separator: "." };
    }

    return {
      decimals: tail.length,
      separator: text[index],
    };
  }

  function formatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleString(undefined, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "";
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function injectStyle() {
    const css = `
      #${PANEL_ID} {
        margin: 12px 0;
        color: #dbe2ea;
        background: rgba(22, 30, 38, 0.96);
        border: 1px solid rgba(103, 193, 245, 0.22);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.25);
        font-family: Arial, Helvetica, sans-serif;
      }

      #${PANEL_ID}.sscp-floating {
        position: fixed;
        z-index: 10000;
        top: clamp(116px, 16vh, 180px);
        width: min(var(--sscp-panel-width, 300px), calc(100vw - 32px));
        height: min(var(--sscp-panel-height, 620px), calc(100vh - clamp(116px, 16vh, 180px) - 24px));
        max-height: calc(100vh - clamp(116px, 16vh, 180px) - 24px);
        overflow: auto;
        scrollbar-width: thin;
      }

      #${PANEL_ID}.sscp-floating-left {
        left: 16px;
        right: auto;
      }

      #${PANEL_ID}.sscp-floating-right {
        right: 16px;
        left: auto;
      }

      #${PANEL_ID} .sscp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      #${PANEL_ID} .sscp-title {
        color: #ffffff;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.3;
      }

      #${PANEL_ID} .sscp-subtitle,
      #${PANEL_ID} .sscp-muted,
      #${PANEL_ID} .sscp-updated,
      #${PANEL_ID} .sscp-card-meta,
      #${PANEL_ID} .sscp-section-empty {
        color: #8f98a0;
        font-size: 12px;
      }

      #${PANEL_ID} .sscp-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }

      #${PANEL_ID} .sscp-market-link,
      #${PANEL_ID} .sscp-refresh {
        box-sizing: border-box;
        min-height: 28px;
        padding: 5px 9px;
        border: 1px solid rgba(103, 193, 245, 0.35);
        background: rgba(42, 71, 94, 0.9);
        color: #c7ecff;
        font-size: 12px;
        line-height: 16px;
        text-decoration: none;
        cursor: pointer;
      }

      #${PANEL_ID} .sscp-refresh:disabled {
        cursor: wait;
        opacity: 0.55;
      }

      #${PANEL_ID} .sscp-settings {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      #${PANEL_ID} .sscp-settings summary {
        color: #c7ecff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
      }

      #${PANEL_ID} .sscp-settings-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 8px;
      }

      #${PANEL_ID} .sscp-settings-title {
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 5px;
      }

      #${PANEL_ID} .sscp-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 22px;
        color: #dbe2ea;
        font-size: 12px;
        line-height: 1.25;
      }

      #${PANEL_ID} .sscp-toggle input {
        flex: 0 0 auto;
      }

      #${PANEL_ID} .sscp-select-row {
        margin-bottom: 7px;
      }

      #${PANEL_ID} .sscp-select-row,
      #${PANEL_ID} .sscp-number-row {
        display: flex;
        flex-direction: column;
        gap: 5px;
        color: #dbe2ea;
        font-size: 12px;
        line-height: 1.25;
      }

      #${PANEL_ID} .sscp-number-row {
        margin-top: 6px;
      }

      #${PANEL_ID} .sscp-select-row select,
      #${PANEL_ID} .sscp-number-row input {
        width: 100%;
        min-height: 28px;
        box-sizing: border-box;
        border: 1px solid rgba(103, 193, 245, 0.35);
        background: #1b2838;
        color: #dbe2ea;
        font-size: 12px;
      }

      #${PANEL_ID} .sscp-body {
        padding: 10px 12px 12px;
      }

      #${PANEL_ID} .sscp-state,
      #${PANEL_ID} .sscp-empty,
      #${PANEL_ID} .sscp-error {
        padding: 10px 0;
        font-size: 13px;
        line-height: 1.5;
      }

      #${PANEL_ID} .sscp-error {
        color: #ffd0c7;
      }

      #${PANEL_ID} .sscp-error-title {
        color: #ffffff;
        font-weight: 700;
        margin-bottom: 3px;
      }

      #${PANEL_ID} .sscp-spinner {
        display: inline-block;
        width: 11px;
        height: 11px;
        margin-right: 8px;
        border: 2px solid rgba(255, 255, 255, 0.25);
        border-top-color: #67c1f5;
        border-radius: 50%;
        vertical-align: -2px;
        animation: sscp-spin 0.8s linear infinite;
      }

      @keyframes sscp-spin {
        to { transform: rotate(360deg); }
      }

      #${PANEL_ID} .sscp-summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      #${PANEL_ID} .sscp-summary-card {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.04);
        color: #dbe2ea;
        text-decoration: none;
      }

      #${PANEL_ID} .sscp-summary-card strong {
        color: #a4d007;
        font-size: 17px;
        line-height: 1.25;
      }

      #${PANEL_ID} .sscp-summary-card span {
        color: #8f98a0;
        font-size: 12px;
        line-height: 1.3;
      }

      #${PANEL_ID} .sscp-summary-card .sscp-summary-label {
        color: #ffffff;
        font-weight: 700;
      }

      #${PANEL_ID} .sscp-updated {
        margin-top: 8px;
      }

      #${PANEL_ID} .sscp-section {
        margin-top: 10px;
      }

      #${PANEL_ID} .sscp-section summary {
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      #${PANEL_ID} .sscp-section-empty {
        padding-top: 7px;
      }

      #${PANEL_ID} .sscp-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 7px;
      }

      #${PANEL_ID} .sscp-row {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 42px;
        padding: 5px 7px;
        background: rgba(0, 0, 0, 0.18);
        color: #dbe2ea;
        text-decoration: none;
      }

      #${PANEL_ID} .sscp-row:hover {
        background: rgba(103, 193, 245, 0.13);
      }

      #${PANEL_ID} .sscp-icon {
        width: 38px;
        height: 38px;
        object-fit: cover;
        background: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .sscp-icon-empty {
        display: block;
      }

      #${PANEL_ID} .sscp-card-main {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
      }

      #${PANEL_ID} .sscp-card-name {
        overflow: hidden;
        color: #ffffff;
        font-size: 13px;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${PANEL_ID} .sscp-price-box {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        white-space: nowrap;
      }

      #${PANEL_ID} .sscp-price-box span {
        display: flex;
        align-items: baseline;
        gap: 4px;
      }

      #${PANEL_ID} .sscp-price-box em {
        color: #8f98a0;
        font-size: 11px;
        font-style: normal;
      }

      #${PANEL_ID} .sscp-price {
        color: #a4d007;
        font-size: 13px;
        white-space: nowrap;
      }

      #${PANEL_ID} .sscp-buy-price {
        color: #67c1f5;
      }

      #${PANEL_ID} .sscp-net-price {
        color: #f6c75a;
      }

      @media (max-width: 760px) {
        #${PANEL_ID} .sscp-summary-grid,
        #${PANEL_ID} .sscp-settings-grid {
          grid-template-columns: 1fr;
        }

        #${PANEL_ID} .sscp-row {
          grid-template-columns: 34px minmax(0, 1fr) auto;
        }

        #${PANEL_ID} .sscp-icon {
          width: 34px;
          height: 34px;
        }
      }
    `;

    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
