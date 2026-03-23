// ==UserScript==
// @name         PSNINE Activity Tracker (via Baidu) - AutoPilot
// @namespace    http://tampermonkey.net/
// @version      2.17.1-AutoPilot
// @description  修复 DOM 加载顺序导致的 null 报错，实现双语无缝切换，并保持所有底线逻辑
// @author       KlausVorutsu
// @match        https://www.psnine.com/psnid/*
// @match        https://www.baidu.com/s?*
// @connect      baidu.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        window.close
// ==/UserScript==

(function() {
    'use strict';

    const log = (msg, data = "") => console.log(`[PSN-Tracker] ${msg}`, data);

    // ==========================================
    // 0. i18n 国际化词典配置
    // ==========================================
    const i18nDict = {
        zh: {
            navBtn: "足迹",
            maxPages: "最大抓取(页):",
            ready: "就绪",
            antiSleep: "💡 防休眠策略：",
            popupMode: "独立迷你窗口运行",
            popupTipTitle: "抓取时新窗口会自动弹出。您可以将其移至屏幕边缘，但请绝对不要关闭它，否则抓取会立刻中断！",
            popupTip: "(弹窗可移开，请勿关闭) ℹ️",
            tabMode: "传统新标签页打开",
            tabTipTitle: "由于现代浏览器的内存节省和后台休眠机制，非当前焦点标签页的请求会被挂起。如果您发现抓取进度卡住，请手动点击进入该百度标签页以唤醒脚本。",
            tabTip: "(受休眠限制，卡住需手动唤醒) ℹ️",
            autoClose: "抓取后自动关闭百度",
            noteHeader: "ℹ️ 注意：",
            noteBody: "抓取结果取决于百度引擎实际收录量，未必包含全部历史足迹。",
            searchPlaceholder: "🔍 实时过滤结果...",
            startBtn: "🚀 开始自动抓取",
            runningBtn: "自动抓取中...",
            stopBtn: "强制停止",
            loaded: "已载入: {num} 条",
            cat1: "💬 社区讨论",
            cat2: "🏆 奖杯Tip",
            cat3: "📝 测评评分",
            cat4: "👻 其他参与",
            cat5: "📊 排行榜"
        },
        en: {
            navBtn: "Tracker",
            maxPages: "Max Pages:",
            ready: "Ready",
            antiSleep: "💡 Anti-Sleep Strategy:",
            popupMode: "Popup Window Mode",
            popupTipTitle: "A new window will pop up. You can move it to the edge, but absolutely DO NOT close it, or tracking will abort!",
            popupTip: "(Can be moved, DO NOT close) ℹ️",
            tabMode: "Background Tab Mode",
            tabTipTitle: "Due to modern browser memory saving mechanisms, background tabs might be suspended. If tracking stalls, click the Baidu tab to wake it up.",
            tabTip: "(Subject to sleep limits, click tab to wake) ℹ️",
            autoClose: "Auto-close Baidu when finished",
            noteHeader: "ℹ️ Note: ",
            noteBody: "Results depend on Baidu's actual index and may not include all history.",
            searchPlaceholder: "🔍 Filter results in real-time...",
            startBtn: "🚀 Start Auto-Tracker",
            runningBtn: "Tracking...",
            stopBtn: "Force Stop",
            loaded: "Loaded: {num} items",
            cat1: "💬 Discussion",
            cat2: "🏆 Trophy Tip",
            cat3: "📝 Review/Score",
            cat4: "👻 Other",
            cat5: "📊 Leaderboard"
        }
    };

    let currentLang = GM_getValue("psn_lang", "zh");
    const t = (key, params = {}) => {
        let text = i18nDict[currentLang][key] || key;
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    };

    // ==========================================
    // 1. 百度搜索页逻辑 (后台引擎，完全动态化)
    // ==========================================
    if (window.location.host === 'www.baidu.com' && window.location.search.includes("site%3Apsnine.com")) {
        const isDebug = GM_getValue("psn_debug_mode", false);
        let lastProcessedPN = null;

        const initialParams = new URLSearchParams(window.location.search);
        const wd = initialParams.get('wd') || "";
        const match = wd.match(/"([^"]+)"/);
        const targetId = match ? match[1] : "";

        const extractDetailedData = (currentPN, isBlank) => {
            const containers = document.querySelectorAll('.c-container, .result, [class*="result-op"], .result-op');
            let results = [];
            let rawSummary = [];

            const isAutoPilot = GM_getValue("psn_tracker_status") === "running" || initialParams.get('autopilot') === 'true';
            const maxPages = GM_getValue("psn_max_pages", 30);
            const currentPageNum = Math.floor(parseInt(currentPN) / 10) + 1;
            let actionLog = "";
            let nextTargetUrl = "无";

            let seenHashes = [];
            try {
                seenHashes = JSON.parse(GM_getValue("psn_seen_hashes", "[]"));
            } catch (e) { seenHashes = []; }

            if (containers.length > 0) {
                containers.forEach((el, index) => {
                    const a = el.querySelector('h3 a') || el.querySelector('a');
                    const rawTitle = a ? a.innerText.trim() : "";
                    const fullText = (el.innerText || "").replace(/\s+/g, ' ');
                    const url = a ? a.href : "";
                    const isAds = rawTitle === "" || rawTitle.includes("") || url.includes("top.baidu.com") || fullText.includes("百度信誉");

                    let preview = "";
                    let statusLabel = "";

                    if (isAds) {
                        statusLabel = "❌ 广告/无效";
                    } else if (rawTitle && a) {
                        const idIndex = targetId ? fullText.toLowerCase().indexOf(targetId.toLowerCase()) : -1;
                        preview = idIndex !== -1 ?
                            (idIndex > 10 ? "..." : "") + fullText.substring(Math.max(0, idIndex - 10), idIndex + 130) + "..." :
                            (targetId ? `${targetId} 参与的讨论: ${fullText.substring(0, 150)}...` : `${fullText.substring(0, 150)}...`);

                        const itemHash = rawTitle + "|||" + preview;

                        if (seenHashes.includes(itemHash)) {
                            statusLabel = "♻️ 重复跳过";
                        } else {
                            statusLabel = "✅ 新增提取";
                            seenHashes.push(itemHash);

                            const cleanTitle = rawTitle.replace('_PSNINE', '').trim();

                            let category = '社区讨论';
                            if (cleanTitle.includes('排行榜')) {
                                category = '排行榜';
                            } else if (cleanTitle.includes('奖杯 -') || cleanTitle.includes('奖杯-')) {
                                category = '奖杯Tip';
                            } else if (cleanTitle.includes('》测评评分')) {
                                category = '测评评分';
                            } else if (preview.includes('参与的讨论:')) {
                                category = '其他参与';
                            }

                            results.push({ title: cleanTitle, href: url, preview: preview, category: category });
                        }
                    }

                    const hasID = targetId ? fullText.toLowerCase().includes(targetId.toLowerCase()) : false;
                    rawSummary.push({ id: index + 1, title: rawTitle, hasID: hasID, status: statusLabel });
                });
                GM_setValue("psn_seen_hashes", JSON.stringify(seenHashes));
            }

            if (isAutoPilot) {
                if (currentPageNum >= maxPages) {
                    actionLog = `[拦截] 达到最大页数 (${maxPages})，停止。`;
                    GM_setValue("psn_tracker_status", "stopped");
                    if (!isDebug) setTimeout(() => window.close(), 600);
                } else if (!isBlank) {
                    let nextBtn = null;
                    const pageLinks = document.querySelectorAll('#page a, .page-inner a, #page-controller a, a.n');
                    for (let btn of pageLinks) {
                        const txt = (btn.textContent || btn.innerText || "").replace(/\s+/g, '');
                        if (txt.includes('下一页') || txt === '下一页>') { nextBtn = btn; break; }
                    }
                    if (nextBtn && nextBtn.href) {
                        nextTargetUrl = nextBtn.href;
                        actionLog = `[爬坡] 找到原生按钮，触发 PJAX 翻页。`;
                        setTimeout(() => nextBtn.click(), 1500 + Math.random() * 1500);
                    } else {
                        const bodyText = document.body.innerText || "";
                        if (bodyText.includes('省略了一些内容相似的条目') || bodyText.includes('可以看到所有搜索结果')) {
                            actionLog = `[折叠到底] 百度提示省略了相似内容，已到达物理极限。`;
                        } else {
                            actionLog = `[异常截断] 未找到“下一页”按钮。`;
                        }
                        GM_setValue("psn_tracker_status", "stopped");
                        if (!isDebug) setTimeout(() => window.close(), 600);
                    }
                } else {
                    actionLog = `[空白] 页面无结果。`;
                    GM_setValue("psn_tracker_status", "stopped");
                    if (!isDebug) setTimeout(() => window.close(), 600);
                }
            }

            GM_setValue("psn_bridge_data", JSON.stringify({
                data: results, rawCount: containers.length, rawSummary: rawSummary, pn: currentPN, action: actionLog, currentUrl: window.location.href, nextUrl: nextTargetUrl, ts: Date.now(), token: Math.random()
            }));
        };

        setInterval(() => {
            const currentParams = new URLSearchParams(window.location.search);
            const currentPN = currentParams.get('pn') || "0";

            if (currentPN !== lastProcessedPN) {
                const containers = document.querySelectorAll('.c-container, .result');
                const bodyText = document.body.innerText || "";
                const isBlank = bodyText.includes('未找到相关结果') || bodyText.includes('抱歉，没有找到');

                if (containers.length > 0 || isBlank) {
                    lastProcessedPN = currentPN;
                    setTimeout(() => extractDetailedData(currentPN, isBlank), 800);
                }
            }
        }, 1000);

        return;
    }

    // ==========================================
    // 2. PSNINE 页面逻辑 (原生 UI 深度融合)
    // ==========================================
    const userId = window.location.pathname.split('/').filter(Boolean).pop();
    if (!userId || !window.location.host.includes('psnine.com')) return;

    let masterResults = [];
    let manualPN = 0;
    GM_setValue("psn_tracker_status", "stopped");

    GM_addValueChangeListener("psn_bridge_data", function(name, old_value, new_value, remote) {
        if (!new_value) return;
        try {
            const packet = JSON.parse(new_value);

            // =========================================================================
            // [核心警告] 绝对不要删除以下整个 console.group 块！
            // =========================================================================
            console.group(`[PSN-Tracker] PN: ${packet.pn} 数据与动作`);
            if (packet.action) {
                console.log(`%c[百度端决策]: ${packet.action}`, "color: #1976d2; font-size: 13px; font-weight: bold; background: #e3f2fd; padding: 2px 5px;");
            }

            console.log(`🔗 当前页面 URL:`, packet.currentUrl);
            if (packet.nextUrl && packet.nextUrl !== "无") console.log(`➡️ 下一页目标 URL:`, packet.nextUrl);

            if (packet.rawSummary && packet.rawSummary.length > 0) {
                console.table(packet.rawSummary);
            }
            console.groupEnd();
            // =========================================================================

            if (packet.data && packet.data.length > 0) masterResults = masterResults.concat(packet.data);
            manualPN = parseInt(packet.pn);
            render();
        } catch (e) { log("解析异常", e); }
    });

    GM_addValueChangeListener("psn_tracker_status", function(name, old_val, new_val) {
        if (new_val === "stopped") {
            document.getElementById('f-start-auto').innerText = t('startBtn');
            document.getElementById('f-start-auto').style.background = "#2b82d9";
        }
    });

    const panel = document.createElement('div');
    panel.id = "psn-footprint-panel";
    panel.style = 'display:none; position:absolute; top:40px; right:0; width:480px; max-height:85vh; background:#353c48; border-radius:3px; z-index:10000; flex-direction:column; box-shadow:0 8px 24px rgba(0,0,0,0.6); border: 1px solid #2d333b; cursor:default; color:#9ba7b6; text-align:left; line-height:normal;';

    // =========================================================================
    // [核心警告] 绝对不要删除窗口运行/新标签页的一切解释和tooltip！
    // =========================================================================
    panel.innerHTML = `
        <div style="padding:15px; background:#2d333b; border-bottom:1px solid #23282e; border-radius:3px 3px 0 0; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px; font-size:12px;">
                <span style="color:#fff; font-weight:bold;" data-i18n="maxPages">最大抓取(页):</span>
                <input type="number" id="max-p-input" value="30" style="width:50px; padding:4px; border:1px solid #1e2228; background:#1e2228; color:#fff; border-radius:3px; outline:none;">
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
                <span id="v-status" style="font-size:11px; color:#6b7989;" data-i18n="ready">就绪</span>
                <button id="lang-toggle" style="background:transparent; border:1px solid #6b7989; color:#9ba7b6; border-radius:3px; cursor:pointer; font-size:10px; padding:2px 6px; font-weight:bold; transition:0.2s;" onmouseover="this.style.color='#fff';this.style.borderColor='#fff';" onmouseout="this.style.color='#9ba7b6';this.style.borderColor='#6b7989';">EN</button>
            </div>
        </div>

        <div style="padding:15px; border-bottom:1px solid #2d333b;">
            <div style="display:flex; flex-direction:column; gap:8px; font-size:12px; background:#292f36; padding:10px; border-radius:4px; border:1px solid #23282e;">
                <strong style="color:#a0b1c4;" data-i18n="antiSleep">💡 防休眠策略：</strong>

                <label style="cursor:pointer; color:#e2e8f0; display:flex; align-items:center; gap:5px;">
                    <input type="radio" name="open-mode" value="popup" checked>
                    <span data-i18n="popupMode">独立迷你窗口运行</span>
                    <span data-i18n-title="popupTipTitle" title="抓取时新窗口会自动弹出..." style="font-size:11px; color:#8b949e; font-weight:normal; cursor:help; border-bottom:1px dotted #8b949e; margin-left:2px;" data-i18n="popupTip">(弹窗可移开，请勿关闭) ℹ️</span>
                </label>

                <label style="cursor:pointer; color:#6b7989; display:flex; align-items:center; gap:5px;">
                    <input type="radio" name="open-mode" value="tab">
                    <span data-i18n="tabMode">传统新标签页打开</span>
                    <span data-i18n-title="tabTipTitle" title="由于现代浏览器的内存节省和后台休眠机制..." style="font-size:11px; color:#8b949e; font-weight:normal; cursor:help; border-bottom:1px dotted #8b949e; margin-left:2px;" data-i18n="tabTip">(受休眠限制，卡住需手动唤醒) ℹ️</span>
                </label>
            </div>

            <div style="margin-top:12px; font-size:12px;">
                <label style="cursor:pointer; color:#9ba7b6; display:flex; align-items:center; gap:5px;"><input type="checkbox" id="auto-close-check" checked> <span data-i18n="autoClose">抓取后自动关闭百度</span></label>
            </div>

            <div style="font-size:11px; color:#8b949e; margin-top:8px; background:#23282e; padding:6px; border-radius:4px; border:1px solid #1e2228; line-height:1.4;">
                <strong style="color:#d29922;" data-i18n="noteHeader">ℹ️ 注意：</strong><span data-i18n="noteBody">抓取结果取决于百度引擎实际收录量，未必包含全部历史足迹。</span>
            </div>

            <div style="margin-top:10px;">
                <input type="text" id="search-input" data-i18n-placeholder="searchPlaceholder" placeholder="🔍 实时过滤结果..." style="width:100%; padding:8px 10px; border:1px solid #1e2228; background:#1e2228; color:#fff; border-radius:4px; box-sizing:border-box; font-size:13px; outline:none;">
            </div>

            <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:10px; font-size:12px; user-select:none;">
                <label style="cursor:pointer; display:flex; align-items:center; gap:3px;"><input type="checkbox" class="cat-filter" value="社区讨论" checked><span data-i18n="cat1">💬 社区讨论</span></label>
                <label style="cursor:pointer; display:flex; align-items:center; gap:3px;"><input type="checkbox" class="cat-filter" value="奖杯Tip" checked><span data-i18n="cat2">🏆 奖杯Tip</span></label>
                <label style="cursor:pointer; display:flex; align-items:center; gap:3px;"><input type="checkbox" class="cat-filter" value="测评评分" checked><span data-i18n="cat3">📝 测评评分</span></label>
                <label style="cursor:pointer; display:flex; align-items:center; gap:3px;"><input type="checkbox" class="cat-filter" value="其他参与" checked><span data-i18n="cat4">👻 其他参与</span></label>
                <label style="cursor:pointer; display:flex; align-items:center; gap:3px;"><input type="checkbox" class="cat-filter" value="排行榜" checked><span data-i18n="cat5">📊 排行榜</span></label>
            </div>
        </div>

        <div id="p-list" style="overflow-y:auto; flex-grow:1; padding:15px; background:#353c48; min-height:180px;"></div>

        <div style="padding:15px; background:#2d333b; border-top:1px solid #23282e; display:grid; grid-template-columns: 1fr; gap:10px; border-radius:0 0 3px 3px;">
            <button id="f-start-auto" style="padding:10px; background:#2b82d9; color:white; border:none; cursor:pointer; font-weight:bold; font-size:13px; border-radius:4px;" data-i18n="startBtn">🚀 开始自动抓取</button>
            <button id="f-stop" style="padding:8px; background:transparent; color:#e53935; border:1px solid #e53935; cursor:pointer; font-weight:bold; border-radius:4px; font-size:12px;" data-i18n="stopBtn">强制停止</button>
        </div>
    `;

    // 动态应用语言的函数
    const applyLang = () => {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n')); });
        document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
        const navTextSpan = document.getElementById('nav-btn-text');
        if (navTextSpan) navTextSpan.innerText = t('navBtn');
        const toggleBtn = document.getElementById('lang-toggle');
        if (toggleBtn) toggleBtn.innerText = currentLang === 'zh' ? 'EN' : '中';

        const isRunning = GM_getValue("psn_tracker_status") === "running";
        const startBtn = document.getElementById('f-start-auto');
        if (startBtn) startBtn.innerText = isRunning ? t('runningBtn') : t('startBtn');
        const statusEl = document.getElementById('v-status');
        if (statusEl) {
            statusEl.innerText = masterResults.length > 0 ? t('loaded', {num: masterResults.length}) : t('ready');
        }
    };

    // ==========================================
    // 3. 原生导航栏注入与 Hover/Click 锁定逻辑
    // ==========================================
    let isPanelLocked = false;
    let hoverTimeout = null;

    const injectNavButton = () => {
        const pcMenu = document.getElementById('pcmenu');
        if (pcMenu && !document.getElementById('nav-psn-footprint-li')) {
            const li = document.createElement('li');
            li.className = "dropdown";
            li.id = "nav-psn-footprint-li";
            li.style.position = "relative";

            const a = document.createElement('a');
            a.href = "javascript:void(0)";
            a.innerHTML = `<span id="nav-btn-text">${t('navBtn')}</span> <span id="lock-icon" style="font-size:10px; opacity:0.5; transition:0.2s;">▾</span>`;

            li.appendChild(a);
            li.appendChild(panel);
            pcMenu.appendChild(li);

            li.addEventListener('mouseenter', () => {
                clearTimeout(hoverTimeout);
                if (!isPanelLocked) panel.style.display = 'flex';
            });

            li.addEventListener('mouseleave', () => {
                if (!isPanelLocked) {
                    hoverTimeout = setTimeout(() => { panel.style.display = 'none'; }, 200);
                }
            });

            a.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                isPanelLocked = !isPanelLocked;
                panel.style.display = isPanelLocked ? 'flex' : 'none';
                document.getElementById('lock-icon').innerText = isPanelLocked ? '📌' : '▾';
                document.getElementById('lock-icon').style.opacity = isPanelLocked ? '1' : '0.5';
            });

            panel.addEventListener('click', (e) => e.stopPropagation());

            document.addEventListener('click', (e) => {
                if (isPanelLocked && !li.contains(e.target)) {
                    isPanelLocked = false;
                    panel.style.display = 'none';
                    document.getElementById('lock-icon').innerText = '▾';
                    document.getElementById('lock-icon').style.opacity = '0.5';
                }
            });
        }
    };
    // 必须确保先执行 DOM 注入！
    injectNavButton();

    // ==========================================
    // 核心修复：DOM 注入后，再绑定事件和应用语言
    // ==========================================
    document.getElementById('lang-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        currentLang = currentLang === 'zh' ? 'en' : 'zh';
        GM_setValue("psn_lang", currentLang);
        applyLang();
        render();
    });

    applyLang();

    // ==========================================
    // 4. 渲染引擎
    // ==========================================
    document.querySelectorAll('.cat-filter').forEach(cb => cb.addEventListener('change', render));

    const badgeConfig = {
        '社区讨论': { textKey: 'cat1', color: '#64b5f6', bg: 'rgba(100, 181, 246, 0.15)' },
        '奖杯Tip': { textKey: 'cat2', color: '#ffb74d', bg: 'rgba(255, 183, 77, 0.15)' },
        '测评评分': { textKey: 'cat3', color: '#81c784', bg: 'rgba(129, 199, 132, 0.15)' },
        '排行榜': { textKey: 'cat4', color: '#ba68c8', bg: 'rgba(186, 104, 200, 0.15)' },
        '其他参与': { textKey: 'cat5', color: '#90a4ae', bg: 'rgba(144, 164, 174, 0.15)' }
    };

    function render() {
        const keyword = document.getElementById('search-input').value.toLowerCase().trim();
        const activeCategories = Array.from(document.querySelectorAll('.cat-filter:checked')).map(cb => cb.value);

        const filteredResults = masterResults.filter(r => {
            const matchKeyword = r.title.toLowerCase().includes(keyword) || r.preview.toLowerCase().includes(keyword);
            return matchKeyword && activeCategories.includes(r.category);
        });

        document.getElementById('p-list').innerHTML = filteredResults.map((r, i) => {
            const targetIds = [userId].filter(Boolean);
            let highlightedPreview = r.preview;

            if (targetIds.length > 0) {
                const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = targetIds.map(escapeRegExp).join('|');
                const regex = new RegExp(`(${pattern})`, 'gi');
                highlightedPreview = highlightedPreview.replace(
                    regex,
                    `<a href="https://www.psnine.com/psnid/$1" class="psnnode" target="_blank" style="background:#2b82d9; color:#fff; padding:1px 4px; border-radius:3px; font-weight:bold; text-decoration:none;">$1</a>`
                );
            }

            const badge = badgeConfig[r.category] || badgeConfig['社区讨论'];
            const badgeHtml = `<span style="background:${badge.bg}; color:${badge.color}; padding:2px 5px; border-radius:4px; font-size:11px; margin-right:6px; font-weight:normal; white-space:nowrap; flex-shrink:0;">${t(badge.textKey)}</span>`;

            return `
            <div style="margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #2d333b;">
                <div style="font-size:13px; display:flex; align-items:flex-start;">
                    ${badgeHtml}
                    <a href="${r.href}" target="_blank" style="color:#d1d5da; font-weight:bold; text-decoration:none; word-break:break-all; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#d1d5da'">${r.title}</a>
                </div>
                <div style="font-size:12px; color:#8b949e; margin-top:6px; line-height:1.5; background:#252a32; padding:8px; border-left:3px solid ${badge.color}; border-radius:0 3px 3px 0; word-wrap:break-word; word-break:break-all;">${highlightedPreview}</div>
            </div>
            `;
        }).join('');

        const statusEl = document.getElementById('v-status');
        if (statusEl) {
            statusEl.innerText = masterResults.length > 0 ? t('loaded', {num: masterResults.length}) : t('ready');
        }
    }

    document.getElementById('search-input').addEventListener('input', render);

    const openBaidu = (pn, isAutoStart = false) => {
        manualPN = parseInt(pn);
        const autoClose = document.getElementById('auto-close-check').checked;
        GM_setValue("psn_debug_mode", !autoClose);
        const openMode = document.querySelector('input[name="open-mode"]:checked').value;
        const wd = encodeURIComponent(`site:psnine.com "${userId}"`);
        let url = `https://www.baidu.com/s?wd=${wd}&pn=${pn}&oq=${wd}&ie=utf-8&fenlei=256&rsv_idx=1`;
        if (isAutoStart) {
            url += "&autopilot=true";
        }

        if (isAutoStart) {
            GM_setValue("psn_max_pages", parseInt(document.getElementById('max-p-input').value) || 30);
            GM_setValue("psn_tracker_status", "running");
            GM_setValue("psn_seen_hashes", "[]");
            document.getElementById('f-start-auto').innerText = t('runningBtn');
            document.getElementById('f-start-auto').style.background = "#586069";
        } else {
            GM_setValue("psn_tracker_status", "stopped");
        }

        if (openMode === 'popup') {
            const popup = window.open(url, 'BaiduTrackerPopup', 'width=600,height=600,left=50,top=50,resizable=yes,scrollbars=yes');
            if (!popup || popup.closed) {
                alert("⚠️ 独立窗口被浏览器拦截！请允许弹窗，或改用新标签页模式。\n⚠️ Popup blocked! Allow popups or use background tab mode.");
                GM_setValue("psn_tracker_status", "stopped");
            }
        } else {
            GM_openInTab(url, { active: false, insert: true });
        }
    };

    document.getElementById('f-start-auto').onclick = () => { masterResults = []; document.getElementById('search-input').value = ""; render(); openBaidu(0, true); };
    document.getElementById('f-stop').onclick = () => GM_setValue("psn_tracker_status", "stopped");
})();
