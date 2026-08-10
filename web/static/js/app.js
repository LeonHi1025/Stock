/**
 * 台股多指標戰略儀表板主前端腳本 (乾淨穩定修復版)
 */

let rawStockData = [];
let marketData = [];
let activeMode = 'daily'; // 'daily' 或 'realtime'
let activeMarketFilter = 'all'; // 'all', 'twse', 'tpex'
let activeSignalFilter = 'all'; // 'all', 'bullish', 'neutral', 'bearish'
let searchQuery = '';
let selectedStockSymbol = null;
const HIDE_AI_PREDICTION = true; // 依需求暫時隱藏 AI 預測區塊

/**
 * 初始化應用程式：繫結事件、載入資料、渲染首頁
 * 使用具名函式以便在 DOMContentLoaded 已觸發時也能直接呼叫
 */
function initApp() {
    // 1. 初始化資料
    rawStockData = window.INITIAL_STOCK_DATA || [];
    marketData = window.INITIAL_MARKET_DATA || [];

    // 2. 繫結主題切換按鈕
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }

    // 3. 繫結主分頁標籤切換
    const tabDaily = document.getElementById('tabDailyReview');
    const tabRealtime = document.getElementById('tabRealtimeAnalysis');

    if (tabDaily) {
        tabDaily.addEventListener('click', () => switchMode('daily'));
    }
    if (tabRealtime) {
        tabRealtime.addEventListener('click', () => switchMode('realtime'));
    }

    // 4. 渲染大盤卡片與初次檢視模式
    renderIndexGrid();
    switchMode('daily');
}


// 主題切換 (Dark / Light)
function toggleTheme() {
    const html = document.documentElement;
    const curr = html.getAttribute('data-theme') || 'dark';
    const next = curr === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);

    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.innerText = next === 'dark' ? '☀️ 亮色模式' : '🌙 暗色模式';
    }

    // 重新選取股票以套用主題至 K 線圖
    if (selectedStockSymbol) {
        selectStock(selectedStockSymbol);
    }
}

// 模式切換 (本日復盤 vs 即時分析)
function switchMode(mode) {
    activeMode = mode;
    const viewDaily = document.getElementById('viewDailyReview');
    const viewRealtime = document.getElementById('viewRealtimeAnalysis');
    const tabDaily = document.getElementById('tabDailyReview');
    const tabRealtime = document.getElementById('tabRealtimeAnalysis');

    if (mode === 'daily') {
        if (viewDaily) viewDaily.style.display = 'block';
        if (viewRealtime) viewRealtime.style.display = 'none';
        if (tabDaily) tabDaily.classList.add('active');
        if (tabRealtime) tabRealtime.classList.remove('active');
        renderDailyReview();
    } else {
        if (viewDaily) viewDaily.style.display = 'none';
        if (viewRealtime) viewRealtime.style.display = 'block';
        if (tabDaily) tabDaily.classList.remove('active');
        if (tabRealtime) tabRealtime.classList.add('active');
        renderRealtimeAnalysis();
    }
}

// 渲染頂部大盤與加權指數卡片
function renderIndexGrid() {
    const grid = document.getElementById('indexGrid');
    if (!grid) return;

    if (!marketData || marketData.length === 0) {
        grid.innerHTML = `<div class="index-card"><div><strong>加權指數 (TWII)</strong></div><div>市況載入中...</div></div>`;
        return;
    }

    let html = '';
    marketData.forEach(item => {
        const changeVal = parseFloat(item.change || 0);
        const changePct = parseFloat(item.change_pct || 0);
        const isUp = changeVal >= 0;
        const color = isUp ? 'var(--color-bullish)' : 'var(--color-bearish)';
        const sign = isUp ? '+' : '';

        html += `
            <div class="index-card">
                <div class="index-name">${item.name}</div>
                <div class="index-price" style="color:${color}">${item.price}</div>
                <div class="index-change" style="color:${color}">
                    ${sign}${changeVal.toFixed(2)} (${sign}${changePct.toFixed(2)}%)
                </div>
            </div>
        `;
    });
    grid.innerHTML = html;
}

// 市場篩選器點擊處置 (全部 / 上市 / 上櫃)
function setMarketFilter(m, btnEl) {
    activeMarketFilter = m;
    const btns = document.querySelectorAll('.filter-group-market .filter-btn');
    btns.forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderDailyReview();
}

// 訊號篩選器點擊處置 (全部 / 買進 / 觀望 / 賣出)
function setSignalFilter(s, btnEl) {
    activeSignalFilter = s;
    const btns = document.querySelectorAll('.filter-group-signal .filter-btn');
    btns.forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderDailyReview();
}

// 個股排序選單處置 (戰略總分/成交量/收盤價高低/股票代號)
let activeSortOption = 'score_desc';

function handleSortChange(val) {
    activeSortOption = val;
    renderDailyReview();
}

// 關鍵字搜尋框輸入即時處理 (代號/名稱/產業)
function handleSearchInput(val) {
    searchQuery = (val || '').trim();
    renderDailyReview();
}

// 個股分類判斷輔助函式 (多頭/盤整/空頭)
function getStockCategory(s) {
    const status = s.status || '';
    const badge = s.badge_class || '';
    if (status.includes('多') || status.includes('買') || badge.includes('bullish')) return 'bullish';
    if (status.includes('空') || status.includes('賣') || badge.includes('bearish')) return 'bearish';
    return 'neutral';
}

// 渲染 本日復盤 模式內容
function renderDailyReview() {
    const listContainer = document.getElementById('stockListScrollable');
    if (!listContainer) return;

    // 計算頂部數據統計
    let countTotal = rawStockData.length;
    let countBullish = 0;
    let countNeutral = 0;
    let countBearish = 0;

    rawStockData.forEach(s => {
        const cat = getStockCategory(s);
        if (cat === 'bullish') countBullish++;
        else if (cat === 'bearish') countBearish++;
        else countNeutral++;
    });

    const elTotal = document.getElementById('statTotal');
    const elBullish = document.getElementById('statBullish');
    const elNeutral = document.getElementById('statNeutral');
    const elBearish = document.getElementById('statBearish');

    if (elTotal) elTotal.innerText = countTotal;
    if (elBullish) elBullish.innerText = countBullish;
    if (elNeutral) elNeutral.innerText = countNeutral;
    if (elBearish) elBearish.innerText = countBearish;

    // 進行過濾
    const filtered = rawStockData.filter(stock => {
        // 市場篩選
        if (activeMarketFilter === 'twse' && stock.market !== '上市') return false;
        if (activeMarketFilter === 'tpex' && stock.market !== '上櫃') return false;

        // 訊號篩選
        if (activeSignalFilter !== 'all') {
            const cat = getStockCategory(stock);
            if (activeSignalFilter !== cat) return false;
        }

        // 關鍵字搜尋
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const symbol = stock.symbol.toLowerCase();
            const name = stock.name.toLowerCase();
            const industry = (stock.industry || '').toLowerCase();
            if (!symbol.includes(q) && !name.includes(q) && !industry.includes(q)) return false;
        }

        return true;
    });

    // 依據使用者選擇進行多維度動態排序 (Sort Filtered Stock List)
    filtered.sort((a, b) => {
        if (activeSortOption === 'score_desc') {
            return (b.score || 0) - (a.score || 0);
        } else if (activeSortOption === 'vol_desc') {
            return (b.volume || 0) - (a.volume || 0);
        } else if (activeSortOption === 'price_desc') {
            return (b.close || 0) - (a.close || 0);
        } else if (activeSortOption === 'price_asc') {
            return (a.close || 0) - (b.close || 0);
        } else if (activeSortOption === 'symbol_asc') {
            return a.symbol.localeCompare(b.symbol);
        }
        return 0;
    });

    // 渲染左側可滾動清單
    if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-secondary); font-size:0.9rem;">查無符合條件個股</div>`;
        const panel = document.getElementById('stockDetailPanel');
        if (panel) panel.innerHTML = `<div class="detail-placeholder"><h3>查無符合條件個股</h3></div>`;
        return;
    }

    let listHtml = '';
    filtered.forEach(s => {
        const cleanSymbol = s.symbol.split('.')[0];
        const volStr = Math.round(s.volume).toLocaleString();
        const isSelected = selectedStockSymbol === s.symbol;

        listHtml += `
            <div class="stock-item-row ${isSelected ? 'active' : ''}" data-symbol="${s.symbol}" onclick="selectStock('${s.symbol}')">
                <div class="stock-item-main">
                    <div class="stock-item-symbol">
                        ${cleanSymbol} ${s.name}
                        <span class="badge ${s.badge_class}" style="font-size:0.7rem; padding:0.1rem 0.4rem;">${s.status}</span>
                    </div>
                    <div class="stock-item-sub">
                        ${s.market} · ${s.industry} | ${s.wave_pattern}
                    </div>
                </div>
                <div class="stock-item-right">
                    <div class="stock-item-price">$${s.close.toFixed(2)}</div>
                    <div class="stock-item-sub">${volStr} 張</div>
                </div>
            </div>
        `;
    });

    listContainer.innerHTML = listHtml;

    // 預設自動選取全部分類第一檔或保留目前選中項目
    if (filtered.length > 0) {
        const hasCurrent = filtered.some(s => s.symbol === selectedStockSymbol);
        if (!hasCurrent || !selectedStockSymbol) {
            selectedStockSymbol = filtered[0].symbol;
        }
        selectStock(selectedStockSymbol);
    }
}

// 輔助函式：安全數字格式化
const safeFix = (num, dec = 2) => (typeof num === 'number' && !isNaN(num)) ? num.toFixed(dec) : 'N/A';
const safePrice = (num) => (typeof num === 'number' && !isNaN(num)) ? `$${num.toFixed(2)}` : 'N/A';
const safeVol = (num) => (typeof num === 'number' && !isNaN(num)) ? Math.round(num).toLocaleString() : '0';

// 選取指定股票並渲染右欄詳情與 K線圖
window.activeDetailTab = window.activeDetailTab || 'kline';

function switchDetailSubTab(tab) {
    window.activeDetailTab = tab;
    const viewKline = document.getElementById('viewSubTabKline');
    const viewTrend = document.getElementById('viewSubTabTrendline');
    const btnKline = document.getElementById('btnTabKline');
    const btnTrend = document.getElementById('btnTabTrend');

    if (tab === 'kline') {
        if (viewKline) viewKline.style.display = 'block';
        if (viewTrend) viewTrend.style.display = 'none';
        if (btnKline) btnKline.classList.add('active');
        if (btnTrend) btnTrend.classList.remove('active');
    } else {
        if (viewKline) viewKline.style.display = 'none';
        if (viewTrend) viewTrend.style.display = 'block';
        if (btnKline) btnKline.classList.remove('active');
        if (btnTrend) btnTrend.classList.add('active');
    }
}

function selectStock(symbol) {
    selectedStockSymbol = symbol;

    // 高亮左側選取項目
    const items = document.querySelectorAll('.stock-item-row');
    items.forEach(el => {
        if (el.dataset.symbol === symbol) el.classList.add('active');
        else el.classList.remove('active');
    });

    const panel = document.getElementById('stockDetailPanel');
    if (!panel) return;

    const item = rawStockData.find(s => s.symbol === symbol);
    if (!item) {
        panel.innerHTML = `<div class="detail-placeholder"><div class="placeholder-icon">📊</div><h3>請點擊左側股票查看詳情</h3></div>`;
        return;
    }

    const cleanSymbol = item.symbol ? item.symbol.split('.')[0] : '';
    const isBullish = (typeof item.close === 'number' && typeof item.ma60 === 'number') ? (item.close >= item.ma60) : true;
    const fib = item.fib || {};
    const pd = item.price_details || {};
    const of = item.order_flow || {};
    const inst = item.institutional || {};
    const fund = item.fundamentals || {};
    const chip = item.chip_analysis || {};
    const tech = item.technical_matrix || {};

    let fibHtml = '';
    if (isBullish) {
        fibHtml = `
            <div class="metric-pill"><div class="label">60日最高價 (${fib.high_date || ''})</div><div class="val" style="color:var(--color-bullish);">${safePrice(fib.high_price)}</div></div>
            <div class="metric-pill"><div class="label">60日最低價 (${fib.low_date || ''})</div><div class="val" style="color:var(--color-bearish);">${safePrice(fib.low_price)}</div></div>
            <div class="metric-pill"><div class="label">0.382 關鍵支撐</div><div class="val">${safePrice(fib.sup_382)}</div></div>
            <div class="metric-pill"><div class="label">0.500 中軸強支撐</div><div class="val">${safePrice(fib.sup_500)}</div></div>
            <div class="metric-pill"><div class="label">0.618 強力防守位</div><div class="val">${safePrice(fib.sup_618)}</div></div>
            <div class="metric-pill"><div class="label">1.382 向上波段目標</div><div class="val" style="color:var(--color-bullish);">${safePrice(fib.tgt_1382)}</div></div>
        `;
    } else {
        fibHtml = `
            <div class="metric-pill"><div class="label">60日最高價 (${fib.high_date || ''})</div><div class="val" style="color:var(--color-bullish);">${safePrice(fib.high_price)}</div></div>
            <div class="metric-pill"><div class="label">60日最低價 (${fib.low_date || ''})</div><div class="val" style="color:var(--color-bearish);">${safePrice(fib.low_price)}</div></div>
            <div class="metric-pill"><div class="label">0.382 關鍵壓力位</div><div class="val">${safePrice(fib.res_382)}</div></div>
            <div class="metric-pill"><div class="label">0.500 中軸反彈壓力</div><div class="val">${safePrice(fib.res_500)}</div></div>
            <div class="metric-pill"><div class="label">0.618 強力反壓位</div><div class="val">${safePrice(fib.res_618)}</div></div>
            <div class="metric-pill"><div class="label">1.382 向下回測目標</div><div class="val" style="color:var(--color-bearish);">${safePrice(fib.tgt_1382)}</div></div>
        `;
    }

    const reasonsHtml = (item.reason || []).map(r => `<span class="reason-tag" style="font-size:0.78rem; padding:0.2rem 0.55rem; background:rgba(255,255,255,0.06); border-radius:0.25rem;">${r}</span>`).join(' ') || '<span class="reason-tag">無明顯指標異動</span>';
    const kdStr = (typeof item.kd_k === 'number' && typeof item.kd_d === 'number') ? `K:${safeFix(item.kd_k, 1)} / D:${safeFix(item.kd_d, 1)}` : 'N/A';
    const rsiStr = typeof item.rsi5 === 'number' ? safeFix(item.rsi5, 1) : 'N/A';
    const volStr = safeVol(item.volume);
    const closeStr = safePrice(item.close);
    const ma60Str = safePrice(item.ma60);
    const scoreStr = item.score !== undefined ? `${item.score}分` : 'N/A';

    // 新聞情緒數據處理
    const newsData = item.news_sentiment || {
        sentiment_score: 55,
        status: "⚖️ 震盪盤整",
        summary: "市場訊息多空交錯，法人與散戶籌碼處於消化整理階段。",
        news: []
    };
    const newsList = newsData.news || [];
    const newsItemsHtml = newsList.map(n => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.35rem 0; border-bottom:1px dashed rgba(255,255,255,0.08); font-size:0.8rem;">
            <div style="display:flex; align-items:center; gap:0.4rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">
                <span class="badge ${n.sentiment_class === 'bullish' ? 'badge-bullish' : (n.sentiment_class === 'bearish' ? 'badge-bearish' : 'badge-neutral')}" style="font-size:0.7rem; padding:0.1rem 0.4rem;">${n.sentiment_tag || '新聞'}</span>
                <a href="${n.link}" target="_blank" style="color:var(--text-primary); text-decoration:none; overflow:hidden; text-overflow:ellipsis;" title="${n.title}">${n.title}</a>
            </div>
            <div style="font-size:0.72rem; color:var(--text-secondary); margin-left:0.5rem; white-space:nowrap;">${n.source || ''} • ${n.date || ''}</div>
        </div>
    `).join('') || '<div style="font-size:0.8rem; color:var(--text-secondary);">尚無特定個股新聞數據</div>';

    const newsHtml = `
        <div class="detail-card-box" style="margin-bottom:0.75rem;">
            <div class="detail-card-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span>📰 個股新聞與市場情緒判斷</span>
                <span style="font-size:0.78rem; font-weight:normal; color:var(--text-secondary);">情緒指數: <strong style="color:${newsData.sentiment_score >= 60 ? 'var(--color-bullish)' : (newsData.sentiment_score <= 40 ? 'var(--color-bearish)' : 'var(--accent-blue)')}; font-size:0.9rem;">${newsData.sentiment_score}%</strong> (${newsData.status || ''})</span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.5rem; line-height:1.35;">
                💡 <strong>情緒分析結論</strong>：${newsData.summary || ''}
            </div>
            <div style="max-height:150px; overflow-y:auto;">
                ${newsItemsHtml}
            </div>
        </div>
    `;

    // AI K線與趨勢預測處理
    const predData = item.prediction || {
        trend_status: "📈 震盪走高",
        status_class: "bullish",
        bullish_probability: 70,
        target_high_3d: (item.close || 100) * 1.03,
        support_low_3d: (item.close || 100) * 0.97,
        summary: "動能量能尚佳，預期未來數日維持震盪趨勢。",
        predicted_candles: []
    };
    const predCandles = predData.predicted_candles || [];
    const predCandlesHtml = predCandles.map(c => `
        <div class="metric-pill" style="border:1px dashed ${c.is_bullish ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.5)'};">
            <div class="label">${c.step} 預測 (${c.confidence}% 信心)</div>
            <div class="val" style="font-size:0.82rem; color:${c.is_bullish ? 'var(--color-bullish)' : 'var(--color-bearish)'};">
                ${c.is_bullish ? '🔴 陽線' : '🟢 陰線'} $${safeFix(c.close, 2)}
            </div>
            <div style="font-size:0.7rem; color:var(--text-secondary);">高 $${safeFix(c.high, 2)} / 低 $${safeFix(c.low, 2)}</div>
        </div>
    `).join('');

    const predictionHtml = `
        <div class="detail-card-box" style="margin-bottom:0.75rem; background:linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,41,59,0.95)); border:1px solid rgba(59,130,246,0.3);">
            <div class="detail-card-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span>🔮 AI K 線與未來趨勢預測</span>
                <span class="badge ${predData.status_class === 'bullish' ? 'badge-bullish' : (predData.status_class === 'bearish' ? 'badge-bearish' : 'badge-neutral')}" style="font-size:0.8rem; padding:0.2rem 0.55rem;">
                    ${predData.trend_status || ''} (多頭勝率 ${predData.bullish_probability}%)
                </span>
            </div>
            <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:0.6rem; line-height:1.4;">
                🎯 <strong>3日預測目標高點</strong>: <span style="color:var(--color-bullish); font-weight:bold;">$${safePrice(predData.target_high_3d)}</span> | 
                🛡️ <strong>3日預測防守低點</strong>: <span style="color:var(--color-bearish); font-weight:bold;">$${safePrice(predData.support_low_3d)}</span>
                <br>
                💡 <strong>技術面趨勢預測</strong>：${predData.summary || ''}
            </div>
            <div class="metrics-row" style="gap:0.4rem; margin-bottom:0.5rem;">
                ${predCandlesHtml}
            </div>

            <!-- 本股專屬 15,000 次買賣訓練過程與特徵權重展開區 -->
            <div style="border-top:1px dashed rgba(255,255,255,0.1); padding-top:0.5rem;">
                <button id="btnToggleTrainingLog" class="filter-btn" style="width:100%; font-size:0.78rem; padding:0.35rem 0.6rem; background:rgba(59,130,246,0.15); color:var(--accent-blue); border-color:var(--accent-blue); border-radius:0.4rem;" onclick="toggleTrainingLogBox()">
                    🧠 點擊查看【${cleanSymbol} ${item.name || ''}】專屬 15,000 次買賣訓練日誌與特徵權重
                </button>
                <div id="trainingLogBox" style="display:none; margin-top:0.5rem; background:rgba(15,23,42,0.95); padding:0.65rem; border-radius:0.4rem; border:1px solid rgba(59,130,246,0.25);">
                    <div style="font-size:0.78rem; font-weight:bold; color:var(--text-primary); margin-bottom:0.3rem;">📊 近 6 個月特徵加權學習矩陣 (Ridge Weights):</div>
                    <div style="display:flex; flex-wrap:wrap; gap:0.3rem; margin-bottom:0.6rem;">
                        ${(predData.feature_importance || []).map(f => `
                            <span style="font-size:0.73rem; background:rgba(255,255,255,0.06); padding:0.15rem 0.4rem; border-radius:0.25rem; border:1px solid rgba(255,255,255,0.08);">
                                ${f.feature}: <strong style="color:var(--accent-blue);">${f.weight > 0 ? '+' : ''}${f.weight}</strong>
                            </span>
                        `).join('') || '暫無特徵權重'}
                    </div>
                    
                    <div style="font-size:0.78rem; font-weight:bold; color:var(--text-primary); margin-bottom:0.3rem;">🔄 15,000 次買賣策略模擬紀錄抽樣 (含進場原因與出場原因):</div>
                    <table style="width:100%; border-collapse:collapse; color:var(--text-secondary); text-align:left;">
                        <thead>
                            <tr style="font-size:0.72rem; color:var(--accent-blue); border-bottom:1px solid rgba(255,255,255,0.15);">
                                <th style="padding:0.25rem;">迴圈</th>
                                <th style="padding:0.25rem;">進價 ➜ 出價</th>
                                <th style="padding:0.25rem;">損益率</th>
                                <th style="padding:0.25rem;">💡 進場觸發原因</th>
                                <th style="padding:0.25rem;">🎯 出場離場原因</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(predData.training_logs || []).map(l => `
                                <tr style="border-bottom:1px dashed rgba(255,255,255,0.08); font-size:0.74rem;">
                                    <td style="padding:0.25rem; font-weight:bold; color:var(--accent-blue);">#${l.iter}</td>
                                    <td style="padding:0.25rem; white-space:nowrap;">$${l.entry_price} ➜ $${l.exit_price} (${l.holding_days}天)</td>
                                    <td style="padding:0.25rem; color:${l.pnl_pct >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'}; font-weight:bold; white-space:nowrap;">${l.pnl_pct >= 0 ? '+' : ''}${l.pnl_pct}%</td>
                                    <td style="padding:0.25rem; color:var(--text-primary);">${l.entry_reason || '均線架構向上偏多試點進場'}</td>
                                    <td style="padding:0.25rem; color:${l.pnl_pct >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'};">${l.exit_reason || l.outcome}</td>
                                </tr>
                            `).join('') || '<tr><td colspan="5">尚無訓練日誌</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const currTab = window.activeDetailTab || 'kline';

    panel.innerHTML = `
        <div class="detail-header-card">
            <div class="detail-title-group">
                <h2>${cleanSymbol} ${item.name || ''} <span class="badge ${item.badge_class || 'badge-sideways'}" style="font-size:0.85rem; padding:0.25rem 0.65rem;">${item.status || ''}</span></h2>
                <div class="detail-meta-tags">
                    <span>${item.market || ''}</span> • <span>${item.industry || ''}</span> • <span>戰略總分: <strong>${scoreStr}</strong></span>
                </div>
            </div>
            <div class="detail-price-box">
                <div class="detail-price" style="color:${isBullish ? 'var(--color-bullish)' : 'var(--text-primary)'}">${closeStr}</div>
                <div style="font-size:0.8rem; color:var(--text-secondary);">60MA: ${ma60Str}</div>
            </div>
        </div>

        <!-- AI K線趨勢預測卡片區 (暫時隱藏) -->
        ${HIDE_AI_PREDICTION ? '' : predictionHtml}

        <!-- 視窗切換按鈕 Tab Bar -->
        <div class="view-switch-bar">
            <button id="btnTabKline" class="view-switch-btn ${currTab === 'kline' ? 'active' : ''}" onclick="switchDetailSubTab('kline')">
                📈 K線與三重大指標圖 (成交量 / KD / RSI)
            </button>
            <button id="btnTabTrend" class="view-switch-btn ${currTab === 'trendline' ? 'active' : ''}" onclick="switchDetailSubTab('trendline')">
                📉 趨勢線與詳細個股數據資訊
            </button>
        </div>

        <!-- 子視窗 1: K 線與三大指標圖視窗 (包含 K 線、成交量、KD、RSI 子圖表) -->
        <div id="viewSubTabKline" style="display: ${currTab === 'kline' ? 'block' : 'none'};">
            <!-- K線圖頂部對照 Bar -->
            <div style="background:var(--bg-primary); padding:0.65rem 0.85rem; border-radius:0.6rem; border:1px solid var(--border-color); display:flex; flex-direction:column; gap:0.5rem; margin-bottom:0.75rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                    <div style="font-size:0.9rem; font-weight:700; color:var(--text-primary);">
                        📈 原生高解析 SVG 向量 K 線圖與三大指標 (${cleanSymbol} ${item.name || ''})
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center;">
                        <button id="btnToggleChartTradeMarkers" class="filter-btn ${window.showTradeMarkers === true ? 'active' : ''}" style="padding:0.2rem 0.6rem; font-size:0.75rem; background:rgba(59,130,246,0.15); color:var(--accent-blue); border-color:var(--accent-blue);" onclick="toggleChartTradeMarkers()">
                            🎯 ${window.showTradeMarkers === true ? '隱藏' : '顯示'} 15,000次買賣訓練點位
                        </button>
                        <a href="https://tw.stock.yahoo.com/quote/${cleanSymbol}" target="_blank" class="filter-btn" style="text-decoration:none; padding:0.2rem 0.6rem; font-size:0.75rem; background:rgba(16,185,129,0.15); color:var(--color-bearish); border-color:var(--color-bearish);">
                            🔗 Yahoo 股市頁面
                        </a>
                    </div>
                </div>
                
                <div style="display:flex; flex-wrap:wrap; gap:0.5rem 1.1rem; font-size:0.78rem; background:rgba(15,23,42,0.65); padding:0.45rem 0.75rem; border-radius:0.4rem; border:1px solid rgba(255,255,255,0.06);">
                    <div>🔴 <span style="color:#ef4444; font-weight:bold;">高點</span>: ${safePrice(fib.high_price)}</div>
                    <div>🟢 <span style="color:#10b981; font-weight:bold;">低點</span>: ${safePrice(fib.low_price)}</div>
                    <div>🟡 <span style="color:#f59e0b; font-weight:bold;">0.382</span>: ${safePrice(fib.sup_382 || fib.res_382)}</div>
                    <div>🔵 <span style="color:#3b82f6; font-weight:bold;">0.500</span>: ${safePrice(fib.sup_500 || fib.res_500)}</div>
                    <div>💗 <span style="color:#ec4899; font-weight:bold;">0.618</span>: ${safePrice(fib.sup_618 || fib.res_618)}</div>
                    <div>〰️ <span style="color:#f59e0b; font-weight:bold;">60MA</span>: ${ma60Str}</div>
                </div>
            </div>

            <!-- K線與三重大指標圖容器 (650px 高度) -->
            <div class="kline-chart-container" id="klineContainer" style="height: 650px; min-height: 580px; width: 100%; background: #131722;">
                <div id="svgKlineContainer" style="width:100%; height:100%;"></div>
            </div>
        </div>

        <!-- 子視窗 2: 趨勢線與詳細個股資訊視窗 (包含趨勢線圖與全方位數據卡片) -->
        <div id="viewSubTabTrendline" style="display: ${currTab === 'trendline' ? 'block' : 'none'};">
            <div style="background:var(--bg-primary); padding:0.65rem 0.85rem; border-radius:0.6rem; border:1px solid var(--border-color); margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <div style="font-size:0.9rem; font-weight:700; color:var(--accent-blue);">
                        📉 趨勢線動態走勢 (${cleanSymbol} ${item.name || ''})
                    </div>
                    <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.15rem;">
                        點擊右側按鈕可切換「本日分時趨勢」與「整體 60 日波段趨勢」。
                    </div>
                </div>
                <div class="filter-group-market" style="display:flex; gap:0.35rem;">
                    <button id="btnTrendToday" class="filter-btn ${window.currentTrendMode === 'today' ? 'active' : ''}" onclick="setTrendRange('today')">⚡ 本日趨勢</button>
                    <button id="btnTrendOverall" class="filter-btn ${window.currentTrendMode !== 'today' ? 'active' : ''}" onclick="setTrendRange('overall')">📈 整體趨勢</button>
                </div>
            </div>

            <!-- 趨勢線 SVG 圖表容器 -->
            <div class="kline-chart-container" id="trendlineContainer" style="height: 480px; min-height: 420px; width: 100%; background: #131722; margin-bottom:1rem;">
                <div id="svgTrendlineContainer" style="width:100%; height:100%;"></div>
            </div>

            <!-- 詳細個股資訊卡片網格 (本日數據) -->
            <div class="detail-matrix-grid" style="margin-bottom:0.5rem;">
                <!-- 1. 成交價格與金額詳情卡片 -->
                <div class="detail-card-box">
                    <div class="detail-card-title">💰 本日成交價格與交易動態</div>
                    <div class="detail-card-row"><span>開盤價</span><span class="val">$${safeFix(pd.open, 2)}</span></div>
                    <div class="detail-card-row"><span>最高價 / 最低價</span><span class="val" style="color:var(--color-bullish);">$${safeFix(pd.high, 2)}</span> / <span class="val" style="color:var(--color-bearish);">$${safeFix(pd.low, 2)}</span></div>
                    <div class="detail-card-row"><span>當日前次收盤價</span><span class="val">$${closeStr}</span></div>
                    <div class="detail-card-row"><span>漲跌金額 / 幅度</span><span class="val" style="color:${(pd.change || 0) >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'}">${(pd.change || 0) >= 0 ? '+' : ''}${safeFix(pd.change, 2)} (${(pd.change_pct || 0) >= 0 ? '+' : ''}${safeFix(pd.change_pct, 2)}%)</span></div>
                    <div class="detail-card-row"><span>波段振幅 %</span><span class="val">${safeFix(pd.amplitude, 2)}%</span></div>
                    <div class="detail-card-row"><span>估算總成交金額</span><span class="val" style="color:var(--accent-blue);">${safeFix(pd.amount_millions, 1)} 百萬元</span></div>
                </div>

                <!-- 2. 內外盤成交動能對比卡片 (富果官方數據) -->
                <div class="detail-card-box">
                    <div class="detail-card-title">⚖️ 本日內外盤成交動能 <span style="font-size:0.7rem; color:var(--accent-blue); background:rgba(59,130,246,0.15); padding:0.1rem 0.4rem; border-radius:0.2rem; font-weight:normal;">富果行情官方正式數據</span></div>
                    <div class="detail-card-row"><span>外盤 (主動買盤)</span><span class="val" id="valOrderFlowOut" style="color:var(--color-bullish);">${safeVol(of.out_vol)} 張 (${safeFix(of.out_pct, 1)}%)</span></div>
                    <div class="detail-card-row"><span>內盤 (主動賣盤)</span><span class="val" id="valOrderFlowIn" style="color:var(--color-bearish);">${safeVol(of.in_vol)} 張 (${safeFix(of.in_pct, 1)}%)</span></div>
                    
                    <!-- 內外盤比例對比 Bar -->
                    <div class="order-flow-bar-bg" title="外盤(紅): ${safeFix(of.out_pct, 1)}% vs 內盤(綠): ${safeFix(of.in_pct, 1)}%">
                        <div class="order-flow-in-fill" id="barOrderFlowFill" style="width:${safeFix(of.out_pct, 1)}%;"></div>
                    </div>

                    <div class="detail-card-row"><span>買賣力道總結</span><span class="val" id="valOrderFlowSummary" style="color:${(of.out_pct || 50) >= 50 ? 'var(--color-bullish)' : 'var(--color-bearish)'}">${(of.out_pct || 50) >= 50 ? '🔥 主動買盤強勢掌控' : '❄️ 主動賣盤壓制觀望'}</span></div>
                </div>

                <!-- 3. 三大法人買賣超卡片 (TWSE 官方數據) -->
                <div class="detail-card-box">
                    <div class="detail-card-title">🏛️ 三大法人買賣超 <span style="font-size:0.7rem; color:var(--color-bullish); background:rgba(16,185,129,0.15); padding:0.1rem 0.4rem; border-radius:0.2rem; font-weight:normal;">證交所官方正式數據</span></div>
                    <div class="detail-card-row"><span>外資 (Foreign)</span><span class="val" style="color:${(inst.foreign || 0) >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'}">${(inst.foreign || 0) >= 0 ? '+' : ''}${safeVol(inst.foreign)} 張</span></div>
                    <div class="detail-card-row"><span>投信 (Trust)</span><span class="val" style="color:${(inst.trust || 0) >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'}">${(inst.trust || 0) >= 0 ? '+' : ''}${safeVol(inst.trust)} 張</span></div>
                    <div class="detail-card-row"><span>自營商 (Dealer)</span><span class="val" style="color:${(inst.dealer || 0) >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'}">${(inst.dealer || 0) >= 0 ? '+' : ''}${safeVol(inst.dealer)} 張</span></div>
                    <div class="detail-card-row" style="border-top:1px solid rgba(255,255,255,0.08); padding-top:0.3rem;"><span>三大法人合計買賣超</span><span class="val" style="font-size:0.95rem; color:${(inst.total || 0) >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'}">${(inst.total || 0) >= 0 ? '+' : ''}${safeVol(inst.total)} 張</span></div>
                </div>

                <!-- 4. 基本面估值與財務數據卡片 -->
                <div class="detail-card-box">
                    <div class="detail-card-title">🏢 基本面估值與財務 <span style="font-size:0.7rem; color:var(--accent-blue); background:rgba(59,130,246,0.15); padding:0.1rem 0.4rem; border-radius:0.2rem; font-weight:normal;">證交所官方正式數據</span></div>
                    <div class="detail-card-row"><span>本益比 (P/E)</span><span class="val">${safeFix(fund.pe, 1)} 倍</span></div>
                    <div class="detail-card-row"><span>股價淨值比 (P/B)</span><span class="val">${safeFix(fund.pb, 2)} 倍</span></div>
                    <div class="detail-card-row"><span>預估殖利率 %</span><span class="val" style="color:var(--color-bullish);">${safeFix(fund.yield_pct, 2)}%</span></div>
                    <div class="detail-card-row"><span>每股盈餘 (EPS)</span><span class="val">$${safeFix(fund.eps, 2)} 元</span></div>
                    <div class="detail-card-row"><span>估算總市值</span><span class="val">$${safeFix(fund.market_cap, 1)} 億元</span></div>
                </div>

                <!-- 5. 資券籌碼與大戶持股卡片 -->
                <div class="detail-card-box">
                    <div class="detail-card-title">⚓ 資券籌碼分析 <span style="font-size:0.7rem; color:var(--color-bullish); background:rgba(16,185,129,0.15); padding:0.1rem 0.4rem; border-radius:0.2rem; font-weight:normal;">證交所信用交易日報</span></div>
                    <div class="detail-card-row"><span>融資今日餘額</span><span class="val">${safeVol(chip.margin_buy)} 張</span></div>
                    <div class="detail-card-row"><span>融券今日餘額</span><span class="val">${safeVol(chip.short_sell)} 張</span></div>
                    <div class="detail-card-row"><span>券資比 %</span><span class="val" style="color:var(--accent-blue);">${safeFix(chip.short_margin_ratio, 1)}%</span></div>
                    <div class="detail-card-row"><span>主力大戶持股比率</span><span class="val" style="color:var(--color-bullish);">${safeFix(chip.major_holder_pct, 1)}%</span></div>
                </div>
            </div>

            <!-- 近一個月歷史明細數據區 (點擊可展開一個月歷史明細，含標示日期) -->
            <div style="margin-bottom:1rem;">
                <button id="btnToggleMonthHistory" class="filter-btn" style="width:100%; padding:0.65rem; font-size:0.88rem; font-weight:700; background:rgba(59,130,246,0.12); color:var(--accent-blue); border-color:var(--accent-blue); border-radius:0.6rem;" onclick="toggleMonthHistoryTable()">
                    📅 點擊查看近一個月歷史數據明細 (含 YYYY-MM-DD 日期標示)
                </button>
                <div id="monthHistoryTableBox" style="display:none; margin-top:0.75rem; background:var(--bg-primary); padding:0.85rem; border-radius:0.6rem; border:1px solid var(--border-color); overflow-x:auto;">
                </div>
            </div>
        </div>

        <!-- 波段型態與訊號剖析 -->
        <div style="background:var(--bg-primary); padding:0.85rem; border-radius:0.6rem; border:1px solid var(--border-color); margin-bottom:0.75rem;">
            <div style="font-weight:700; color:var(--accent-blue); font-size:0.92rem; margin-bottom:0.25rem;">
                🌀 波段艾略特型態: ${item.wave_pattern || '標準整理'} (${item.wave_status || '觀察中'})
            </div>
            <div style="font-size:0.83rem; color:var(--text-secondary); line-height:1.4;">
                ${item.wave_detail || '暫無型態說明'}
            </div>
        </div>

        <!-- 📰 個股新聞與市場情緒判斷卡片 (位在波段艾略特型態正下方) -->
        ${newsHtml}

        <!-- 指標快照與成交量 -->
        <div class="metrics-row" style="margin-bottom:0.75rem;">
            <div class="metric-pill"><div class="label">成交量(張)</div><div class="val">${volStr}</div></div>
            <div class="metric-pill"><div class="label">KD(9,3,3)</div><div class="val">${kdStr}</div></div>
            <div class="metric-pill"><div class="label">RSI(5)</div><div class="val">${rsiStr}</div></div>
            <div class="metric-pill"><div class="label">60日均線(MA)</div><div class="val">${ma60Str}</div></div>
        </div>

        <!-- 黃金分割率關鍵關卡 -->
        <div style="background:var(--bg-primary); padding:0.85rem; border-radius:0.6rem; border:1px solid var(--border-color); margin-bottom:0.75rem;">
            <div style="font-size:0.88rem; font-weight:700; color:var(--text-primary); margin-bottom:0.6rem;">
                📐 黃金分割率 (Fibonacci) 關鍵關卡數據
            </div>
            <div class="metrics-row">
                ${fibHtml}
            </div>
        </div>

        <!-- 買賣評估依據 -->
        <div style="margin-bottom:0.75rem;">
            <div style="font-size:0.83rem; font-weight:700; color:var(--text-secondary); margin-bottom:0.4rem;">💡 買賣評估依據:</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
                ${reasonsHtml}
            </div>
        </div>
    `;

    // 即時調用 富果 Fugle 行情 API 更新內外盤 100% 真實張數
    fetch(`${FUGLE_BASE}/intraday/quote/${cleanSymbol}`, {
        headers: { 'X-API-KEY': FUGLE_API_KEY }
    })
    .then(r => r.json())
    .then(data => {
        if (data && data.total) {
            const inV = data.total.tradeVolumeAtBid || 0;
            const outV = data.total.tradeVolumeAtAsk || 0;
            const totV = data.total.tradeVolume || (inV + outV);
            if (totV > 0) {
                const oPct = Math.round((outV / totV) * 1000) / 10;
                const iPct = Math.round((100 - oPct) * 10) / 10;
                const elOut = document.getElementById('valOrderFlowOut');
                const elIn = document.getElementById('valOrderFlowIn');
                const elFill = document.getElementById('barOrderFlowFill');
                const elSum = document.getElementById('valOrderFlowSummary');
                if (elOut) elOut.innerHTML = `${outV.toLocaleString()} 張 (${oPct}%)`;
                if (elIn) elIn.innerHTML = `${inV.toLocaleString()} 張 (${iPct}%)`;
                if (elFill) elFill.style.width = `${oPct}%`;
                if (elSum) {
                    elSum.innerHTML = oPct >= 50 ? '🔥 外盤買盤強勢主導 (富果官方即時數據)' : '❄️ 內盤賣盤壓制觀望 (富果官方即時數據)';
                    elSum.style.color = oPct >= 50 ? 'var(--color-bullish)' : 'var(--color-bearish)';
                }
            }
        }
    })
    .catch(() => {});

    // 延長初始等待時間，確保 DOM 容器完整渲染後再繪製
    setTimeout(() => {
        fetchAndDrawSVG('svgKlineContainer', item);
        fetchAndDrawTrendlineSVG('svgTrendlineContainer', item);
    }, 150);
}

// 切換 15,000 次訓練過程日誌顯示
function toggleTrainingLogBox() {
    const box = document.getElementById('trainingLogBox');
    const btn = document.getElementById('btnToggleTrainingLog');
    if (!box) return;
    if (box.style.display === 'none') {
        box.style.display = 'block';
        if (btn) btn.innerText = '🧠 點擊收合 15,000 次買賣訓練日誌與特徵權重';
    } else {
        box.style.display = 'none';
        if (btn) btn.innerText = '🧠 點擊查看本股專屬 15,000 次買賣訓練日誌與特徵權重';
    }
}

// 切換 K 線圖上的 15,000 次買賣訓練點位標記 (預設隱藏)
window.showTradeMarkers = false;
function toggleChartTradeMarkers() {
    window.showTradeMarkers = !window.showTradeMarkers;
    if (selectedStockSymbol) {
        const item = rawStockData.find(s => s.symbol === selectedStockSymbol);
        if (item) {
            selectStock(selectedStockSymbol);
        }
    }
}

// SVG K線歷史快取 (candlesCache)
const candlesCache = {};

// 獲取與繪製 SVG 向量 K 線圖 (支援本機 API 及前端直連富果 Fugle API)
const FUGLE_API_KEY = 'NGI0MTczOTYtYTlmOC00YmQ2LTgwZmUtNjcwOTQ1ODZjMGY5IDc0OWQwNzA2LWYzYmQtNGFhMS1iOGIxLTc1MGJjZjQ4OWM2ZA==';
const FUGLE_BASE = 'https://api.fugle.tw/marketdata/v1.0/stock';

function fetchAndDrawSVG(containerId, item) {
    const cleanSymbol = item.symbol.split('.')[0];

    if (candlesCache[cleanSymbol]) {
        drawKlineSVG(containerId, candlesCache[cleanSymbol], item);
        return;
    }

    // 計算查詢日期區間：近 6 個月
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setMonth(today.getMonth() - 6);
    const toStr = today.toISOString().split('T')[0];
    const fromStr = fromDate.toISOString().split('T')[0];

    // 前端直連 富果 Fugle Historical Candles API
    const fugleUrl = `${FUGLE_BASE}/historical/candles/${cleanSymbol}?timeframe=D&from=${fromStr}&to=${toStr}&sort=asc&fields=open,high,low,close,volume`;

    fetch(fugleUrl, {
        headers: {
            'X-API-KEY': FUGLE_API_KEY
        }
    })
        .then(res => {
            if (!res.ok) throw new Error(`Fugle API error: ${res.status}`);
            return res.json();
        })
        .then(data => {
            // Fugle API 回傳格式: { data: [{ date, open, high, low, close, volume }, ...] }
            const rows = data?.data || [];
            if (rows.length === 0) throw new Error('Fugle returned empty candles');

            const candles = rows.map(r => ({
                time: r.date.slice(0, 10),
                open: r.open,
                high: r.high,
                low: r.low,
                close: r.close,
                volume: Math.round((r.volume ?? 0) / 1000)  // 股 → 張
            }));

            candlesCache[cleanSymbol] = candles;
            drawKlineSVG(containerId, candles, item);
        })
        .catch(err => {
            console.warn('富果 API 抓取失敗，使用備援幾何繪圖', err);
            const candles = generateFallbackCandles(item);
            candlesCache[cleanSymbol] = candles;
            drawKlineSVG(containerId, candles, item);
        });
}


// KD(9,3,3) 數據序列計算
function calculateKDSeries(candles) {
    let k = 50, d = 50;
    return candles.map((c, i) => {
        const start = Math.max(0, i - 8);
        const slice = candles.slice(start, i + 1);
        const maxH = Math.max(...slice.map(s => s.high));
        const minL = Math.min(...slice.map(s => s.low));
        const rsv = (maxH === minL) ? 50 : ((c.close - minL) / (maxH - minL)) * 100;
        k = (2/3) * k + (1/3) * rsv;
        d = (2/3) * d + (1/3) * k;
        return { k: Math.round(k * 10) / 10, d: Math.round(d * 10) / 10 };
    });
}

// RSI(5) 數據序列計算
function calculateRSISeries(candles, period = 5) {
    const rsiArr = [];
    let gains = 0, losses = 0;
    for (let i = 0; i < candles.length; i++) {
        if (i === 0) { rsiArr.push(50); continue; }
        const diff = candles[i].close - candles[i-1].close;
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        if (i <= period) {
            gains += gain; losses += loss;
            if (i === period) {
                const avgG = gains / period, avgL = losses / period;
                rsiArr.push(avgL === 0 ? 100 : Math.round((100 - (100 / (1 + avgG / avgL))) * 10) / 10);
            } else { rsiArr.push(50); }
        } else {
            gains = (gains * (period - 1) + gain) / period;
            losses = (losses * (period - 1) + loss) / period;
            rsiArr.push(losses === 0 ? 100 : Math.round((100 - (100 / (1 + gains / losses))) * 10) / 10);
        }
    }
    return rsiArr;
}

// 原生 SVG 動態 K 線向量圖形繪製引擎 (升級版: 主圖 + 成交量 + KD + RSI 三重獨立子圖表與表格數據)
function drawKlineSVG(containerId, candles, item, retryCount = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let width = container.clientWidth;
    const height = container.clientHeight || 650;

    if (width === 0 && retryCount < 5) {
        requestAnimationFrame(() => drawKlineSVG(containerId, candles, item, retryCount + 1));
        return;
    }
    width = width || 800;
    
    if (!candles || candles.length === 0) {
        container.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--text-secondary);">尚無 K 線數據</div>`;
        return;
    }

    // 版面區塊比例設定 (650px 高度分配)
    const paddingTop = 30;
    const paddingBottom = 20;
    const paddingLeft = 15;
    const paddingRight = 75;
    
    const chartW = width - paddingLeft - paddingRight;
    const totalH = height - paddingTop - paddingBottom;
    
    // 主圖 42% 高度，三分區子圖各 15% 高度，留白 gaps 各 3.5%
    const priceH = totalH * 0.42;
    const subH = totalH * 0.15;
    const gapH = totalH * 0.035;
    
    const priceAreaTop = paddingTop;
    const priceAreaBottom = priceAreaTop + priceH;
    
    const volAreaTop = priceAreaBottom + gapH;
    const volAreaBottom = volAreaTop + subH;
    
    const kdAreaTop = volAreaBottom + gapH;
    const kdAreaBottom = kdAreaTop + subH;
    
    const rsiAreaTop = kdAreaBottom + gapH;
    const rsiAreaBottom = rsiAreaTop + subH;
    
    // 計算數據
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const vols = candles.map(c => c.volume || 0);
    
    const kdSeries = calculateKDSeries(candles);
    const rsiSeries = calculateRSISeries(candles, 5);
    
    const predCandles = (item && item.prediction && item.prediction.predicted_candles) ? item.prediction.predicted_candles : [];
    const predHighs = predCandles.map(p => p.high);
    const predLows = predCandles.map(p => p.low);

    const fib = item.fib || {};
    const extraPrices = [fib.high_price, fib.low_price, fib.sup_382, fib.sup_500, fib.sup_618, fib.res_382, fib.res_500, fib.res_618, item.ma60, ...predHighs, ...predLows].filter(v => typeof v === 'number' && !isNaN(v));
    
    let maxP = Math.max(...highs, ...extraPrices) * 1.015;
    let minP = Math.min(...lows, ...extraPrices) * 0.985;
    if (maxP === minP) { maxP += 1; minP -= 1; }
    const pRange = maxP - minP;
    
    let maxV = Math.max(...vols) || 1;
    
    // 座標映射
    const getPy = (price) => priceAreaBottom - ((price - minP) / pRange) * priceH;
    const getVy = (vol) => volAreaBottom - (vol / maxV) * subH;
    const getKDy = (val) => kdAreaBottom - (Math.max(0, Math.min(100, val)) / 100) * subH;
    const getRSIy = (val) => rsiAreaBottom - (Math.max(0, Math.min(100, val)) / 100) * subH;
    
    const totalSlots = candles.length + (predCandles.length > 0 ? predCandles.length + 1 : 0);
    const slotW = chartW / totalSlots;
    const candleW = Math.max(1.8, slotW * 0.7);
    
    let svgContent = '';
    
    // 1. 主圖網格與右側價格刻度 Y 軸
    const gridRows = 3;
    for (let i = 0; i <= gridRows; i++) {
        const y = priceAreaTop + (priceH / gridRows) * i;
        const pVal = maxP - (pRange / gridRows) * i;
        svgContent += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" class="kline-grid-line" />`;
        svgContent += `<text x="${width - paddingRight + 8}" y="${y + 4}" font-size="11" font-family="monospace, sans-serif" fill="#94a3b8">$${pVal.toFixed(1)}</text>`;
    }
    // 主圖 Y 軸刻度垂直線
    svgContent += `<line x1="${width - paddingRight}" y1="${priceAreaTop}" x2="${width - paddingRight}" y2="${priceAreaBottom}" stroke="rgba(255,255,255,0.25)" stroke-width="1" />`;

    // 2. 支撐壓力與黃金分割虛線
    const drawLineOnly = (price, color, dash = '4, 3') => {
        if (typeof price === 'number' && !isNaN(price)) {
            const y = getPy(price);
            if (y >= priceAreaTop && y <= priceAreaBottom) {
                svgContent += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="${color}" stroke-dasharray="${dash}" stroke-width="1.2" opacity="0.85" />`;
            }
        }
    };
    drawLineOnly(fib.high_price, '#ef4444');
    drawLineOnly(fib.low_price, '#10b981');
    drawLineOnly(fib.sup_382 || fib.res_382, '#f59e0b');
    drawLineOnly(fib.sup_500 || fib.res_500, '#3b82f6');
    drawLineOnly(fib.sup_618 || fib.res_618, '#ec4899');

    // 3. 60日均線
    const ma60Points = [];
    for (let i = 0; i < candles.length; i++) {
        const startIdx = Math.max(0, i - 59);
        const slice = candles.slice(startIdx, i + 1);
        const avg = slice.reduce((acc, curr) => acc + (curr.close || 0), 0) / slice.length;
        const cx = paddingLeft + slotW * i + slotW / 2;
        ma60Points.push({ x: cx, y: getPy(avg) });
    }
    if (ma60Points.length > 1) {
        const pointsStr = ma60Points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        svgContent += `<polyline points="${pointsStr}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round" opacity="0.9" />`;
    }

    // 最新價格標籤
    const lastClose = closes[closes.length - 1];
    if (typeof lastClose === 'number') {
        const lastY = getPy(lastClose);
        const lastColor = (item.ma60 && lastClose >= item.ma60) ? '#ef4444' : '#10b981';
        svgContent += `<line x1="${paddingLeft}" y1="${lastY}" x2="${width - paddingRight}" y2="${lastY}" stroke="${lastColor}" stroke-width="1.5" opacity="0.9" />`;
        svgContent += `<rect x="${width - paddingRight + 2}" y="${lastY - 9}" width="68" height="18" fill="${lastColor}" rx="3" />`;
        svgContent += `<text x="${width - paddingRight + 36}" y="${lastY + 4}" font-size="11" font-family="monospace, sans-serif" fill="#ffffff" text-anchor="middle" font-weight="bold">$${lastClose.toFixed(2)}</text>`;
    }

    // 4. 成交量、KD、RSI 三大圖表刻度與標籤
    const lastVol = vols[vols.length - 1] || 0;
    const lastKD = kdSeries[kdSeries.length - 1] || { k: 50, d: 50 };
    const lastRSI = rsiSeries[rsiSeries.length - 1] || 50;

    // 成交量圖表刻度與 Y 軸實線
    svgContent += `<line x1="${paddingLeft}" y1="${volAreaTop - gapH/2}" x2="${width - paddingRight}" y2="${volAreaTop - gapH/2}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3,3" />`;
    svgContent += `<line x1="${width - paddingRight}" y1="${volAreaTop}" x2="${width - paddingRight}" y2="${volAreaBottom}" stroke="rgba(255,255,255,0.25)" stroke-width="1" />`;
    svgContent += `<text x="${paddingLeft + 5}" y="${volAreaTop - 3}" font-size="11" font-weight="bold" fill="#3b82f6">📊 成交量: ${lastVol.toLocaleString()} 張</text>`;
    svgContent += `<text x="${width - paddingRight + 8}" y="${volAreaTop + 10}" font-size="10" font-family="monospace, sans-serif" fill="#94a3b8">${Math.round(maxV).toLocaleString()}</text>`;
    svgContent += `<text x="${width - paddingRight + 8}" y="${volAreaBottom}" font-size="10" font-family="monospace, sans-serif" fill="#94a3b8">0張</text>`;

    // KD 圖表刻度 (80, 50, 20) 與 Y 軸實線
    svgContent += `<line x1="${paddingLeft}" y1="${kdAreaTop - gapH/2}" x2="${width - paddingRight}" y2="${kdAreaTop - gapH/2}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3,3" />`;
    svgContent += `<line x1="${width - paddingRight}" y1="${kdAreaTop}" x2="${width - paddingRight}" y2="${kdAreaBottom}" stroke="rgba(255,255,255,0.25)" stroke-width="1" />`;
    svgContent += `<line x1="${paddingLeft}" y1="${getKDy(80)}" x2="${width - paddingRight}" y2="${getKDy(80)}" stroke="rgba(239,68,68,0.3)" stroke-dasharray="2,2" />`;
    svgContent += `<line x1="${paddingLeft}" y1="${getKDy(20)}" x2="${width - paddingRight}" y2="${getKDy(20)}" stroke="rgba(16,185,129,0.3)" stroke-dasharray="2,2" />`;
    svgContent += `<text x="${paddingLeft + 5}" y="${kdAreaTop - 3}" font-size="11" font-weight="bold" fill="#f59e0b">📈 KD(9,3,3): K: <tspan fill="#ef4444">${lastKD.k}</tspan> | D: <tspan fill="#3b82f6">${lastKD.d}</tspan></text>`;
    [80, 50, 20].forEach(val => {
        const y = getKDy(val);
        svgContent += `<text x="${width - paddingRight + 8}" y="${y + 3}" font-size="10" font-family="monospace, sans-serif" fill="#94a3b8">${val}</text>`;
    });

    // RSI 圖表刻度 (70, 50, 30) 與 Y 軸實線
    svgContent += `<line x1="${paddingLeft}" y1="${rsiAreaTop - gapH/2}" x2="${width - paddingRight}" y2="${rsiAreaTop - gapH/2}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3,3" />`;
    svgContent += `<line x1="${width - paddingRight}" y1="${rsiAreaTop}" x2="${width - paddingRight}" y2="${rsiAreaBottom}" stroke="rgba(255,255,255,0.25)" stroke-width="1" />`;
    svgContent += `<line x1="${paddingLeft}" y1="${getRSIy(70)}" x2="${width - paddingRight}" y2="${getRSIy(70)}" stroke="rgba(239,68,68,0.3)" stroke-dasharray="2,2" />`;
    svgContent += `<line x1="${paddingLeft}" y1="${getRSIy(50)}" x2="${width - paddingRight}" y2="${getRSIy(50)}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="3,3" />`;
    svgContent += `<line x1="${paddingLeft}" y1="${getRSIy(30)}" x2="${width - paddingRight}" y2="${getRSIy(30)}" stroke="rgba(16,185,129,0.3)" stroke-dasharray="2,2" />`;
    svgContent += `<text x="${paddingLeft + 5}" y="${rsiAreaTop - 3}" font-size="11" font-weight="bold" fill="#a855f7">📉 RSI(5): <tspan fill="#a855f7">${lastRSI}</tspan></text>`;
    [70, 50, 30].forEach(val => {
        const y = getRSIy(val);
        svgContent += `<text x="${width - paddingRight + 8}" y="${y + 3}" font-size="10" font-family="monospace, sans-serif" fill="#94a3b8">${val}</text>`;
    });

    // 5. 繪製 K 線、成交量柱、KD 曲線、RSI 曲線
    const kdKPoints = [];
    const kdDPoints = [];
    const rsiPoints = [];

    candles.forEach((c, idx) => {
        const cx = paddingLeft + slotW * idx + slotW / 2;
        const isUp = c.close >= c.open;
        const colorClass = isUp ? 'kline-candle-up' : 'kline-candle-down';
        const volColorClass = isUp ? 'kline-vol-up' : 'kline-vol-down';
        const hexColor = isUp ? 'var(--color-bullish)' : 'var(--color-bearish)';
        
        const yOpen = getPy(c.open);
        const yClose = getPy(c.close);
        const yHigh = getPy(c.high);
        const yLow = getPy(c.low);
        
        const yBodyTop = Math.min(yOpen, yClose);
        const yBodyBottom = Math.max(yOpen, yClose);
        const bodyH = Math.max(1.5, Math.abs(yOpen - yClose));
        
        // K棒實體與影線
        svgContent += `<line x1="${cx}" y1="${yHigh}" x2="${cx}" y2="${yBodyTop}" stroke="${hexColor}" stroke-width="1.2" />`;
        svgContent += `<line x1="${cx}" y1="${yBodyBottom}" x2="${cx}" y2="${yLow}" stroke="${hexColor}" stroke-width="1.2" />`;
        svgContent += `<rect x="${cx - candleW/2}" y="${yBodyTop}" width="${candleW}" height="${bodyH}" class="${colorClass}" rx="0.5" />`;
        
        // 成交量柱
        const yVolTop = getVy(c.volume);
        const volHeight = Math.max(1, volAreaBottom - yVolTop);
        svgContent += `<rect x="${cx - candleW/2}" y="${yVolTop}" width="${candleW}" height="${volHeight}" class="${volColorClass}" />`;
        
        // KD 點陣
        kdKPoints.push(`${cx.toFixed(1)},${getKDy(kdSeries[idx].k).toFixed(1)}`);
        kdDPoints.push(`${cx.toFixed(1)},${getKDy(kdSeries[idx].d).toFixed(1)}`);

        // RSI 點陣
        rsiPoints.push(`${cx.toFixed(1)},${getRSIy(rsiSeries[idx]).toFixed(1)}`);

        // 日期刻度 (每 15 根標記)
        if (idx % 15 === 0 && c.time) {
            const dateLabel = c.time.slice(5);
            svgContent += `<text x="${cx}" y="${height - 4}" class="kline-text" text-anchor="middle">${dateLabel}</text>`;
        }
    });

    // 繪製 KD 曲線 (K: 紅色, D: 藍色)
    if (kdKPoints.length > 1) {
        svgContent += `<polyline points="${kdKPoints.join(' ')}" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linejoin="round" opacity="0.9" />`;
        svgContent += `<polyline points="${kdDPoints.join(' ')}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" opacity="0.9" />`;
    }

    // 繪製 RSI 曲線 (紫色)
    if (rsiPoints.length > 1) {
        svgContent += `<polyline points="${rsiPoints.join(' ')}" fill="none" stroke="#a855f7" stroke-width="1.6" stroke-linejoin="round" opacity="0.95" />`;
    }

    // 繪製未來 5 日 🔮 AI K線與趨勢預測燭體 (依需求暫時隱藏)
    if (!HIDE_AI_PREDICTION && predCandles.length > 0) {
        const predStartX = paddingLeft + slotW * (candles.length + 0.3);
        svgContent += `<line x1="${predStartX}" y1="${priceAreaTop}" x2="${predStartX}" y2="${rsiAreaBottom}" stroke="rgba(59,130,246,0.5)" stroke-dasharray="4,4" stroke-width="1.5" />`;
        svgContent += `<text x="${predStartX + 6}" y="${priceAreaTop + 14}" font-size="11" font-weight="bold" fill="#60a5fa">🔮 AI 5日K線預測</text>`;

        predCandles.forEach((pc, pIdx) => {
            const pcx = paddingLeft + slotW * (candles.length + 1 + pIdx) + slotW / 2;
            const isUp = pc.is_bullish;
            const pColor = isUp ? '#ef4444' : '#10b981';

            const yOpen = getPy(pc.open);
            const yClose = getPy(pc.close);
            const yHigh = getPy(pc.high);
            const yLow = getPy(pc.low);

            const yBodyTop = Math.min(yOpen, yClose);
            const yBodyBottom = Math.max(yOpen, yClose);
            const bodyH = Math.max(1.5, Math.abs(yOpen - yClose));

            // 半透明與虛線畫出預測 K 線
            svgContent += `<line x1="${pcx}" y1="${yHigh}" x2="${pcx}" y2="${yLow}" stroke="${pColor}" stroke-dasharray="2,2" stroke-width="1.2" opacity="0.9" />`;
            svgContent += `<rect x="${pcx - candleW/2}" y="${yBodyTop}" width="${candleW}" height="${bodyH}" fill="${pColor}" fill-opacity="0.35" stroke="${pColor}" stroke-dasharray="2,2" stroke-width="1.2" rx="0.5" />`;

            // 底部 T+1 ~ T+5 標籤
            svgContent += `<text x="${pcx}" y="${height - 4}" font-size="10" font-weight="bold" fill="#60a5fa" text-anchor="middle">${pc.step}</text>`;
        });
    }

    // 繪製 15,000 次買賣訓練點位與進出場視覺化連線 (預設隱藏)
    if (window.showTradeMarkers === true && item && item.prediction && item.prediction.training_logs) {
        const logs = item.prediction.training_logs || [];
        logs.forEach(l => {
            const entryIdx = Math.min(candles.length - 1, l.entry_idx);
            const exitIdx = Math.min(candles.length - 1, entryIdx + (l.holding_days || 1));
            
            const x1 = paddingLeft + slotW * entryIdx + slotW / 2;
            const y1 = getPy(l.entry_price);
            
            const x2 = paddingLeft + slotW * exitIdx + slotW / 2;
            const y2 = getPy(l.exit_price);
            
            const isProfit = l.pnl_pct >= 0;
            const lineColor = isProfit ? '#ef4444' : '#10b981';
            
            // 交易連線
            svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${lineColor}" stroke-width="2" stroke-dasharray="3,2" opacity="0.85"><title>迴圈 #${l.iter} 交易過程:\n【買進原因】: ${l.entry_reason || '進場點位'}\n【出場原因】: ${l.exit_reason || l.outcome}\n【交易結果】: $${l.entry_price} ➜ $${l.exit_price} (${l.pnl_pct >= 0 ? '+' : ''}${l.pnl_pct}%)</title></line>`;
            
            // 買進進場點標記 (🟢 買)
            svgContent += `<circle cx="${x1}" cy="${y1}" r="4.5" fill="#10b981" stroke="#ffffff" stroke-width="1.2"><title>買進進場點: $${l.entry_price}\n原因: ${l.entry_reason || '技術面點位進場'}</title></circle>`;
            svgContent += `<rect x="${x1 - 18}" y="${y1 + 6}" width="36" height="14" fill="rgba(16,185,129,0.85)" rx="2" />`;
            svgContent += `<text x="${x1}" y="${y1 + 16}" font-size="9" fill="#ffffff" font-weight="bold" text-anchor="middle">🟢買 $${l.entry_price}</text>`;
            
            // 出場點標記 (🔴 賣)
            svgContent += `<circle cx="${x2}" cy="${y2}" r="4.5" fill="${lineColor}" stroke="#ffffff" stroke-width="1.2"><title>出場平倉點: $${l.exit_price} (${l.pnl_pct}%)\n原因: ${l.exit_reason || l.outcome}</title></circle>`;
            svgContent += `<rect x="${x2 - 24}" y="${y2 - 18}" width="48" height="14" fill="${isProfit ? 'rgba(239,68,68,0.9)' : 'rgba(16,185,129,0.9)'}" rx="2" />`;
            svgContent += `<text x="${x2}" y="${y2 - 8}" font-size="9" fill="#ffffff" font-weight="bold" text-anchor="middle">🎯${l.pnl_pct >= 0 ? '+' : ''}${l.pnl_pct}%</text>`;
        });
    }

    container.innerHTML = `
        <svg class="kline-svg-container" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${svgContent}
        </svg>
    `;
}

// 趨勢線範圍切換狀態 (today: 本日, overall: 60日整體)
window.currentTrendMode = 'today';

function setTrendRange(mode) {
    window.currentTrendMode = mode;
    const btnToday = document.getElementById('btnTrendToday');
    const btnOverall = document.getElementById('btnTrendOverall');
    if (btnToday && btnOverall) {
        if (mode === 'today') {
            btnToday.classList.add('active');
            btnOverall.classList.remove('active');
        } else {
            btnToday.classList.remove('active');
            btnOverall.classList.add('active');
        }
    }
    if (selectedStockSymbol) {
        const item = rawStockData.find(s => s.symbol === selectedStockSymbol);
        if (item) {
            fetchAndDrawTrendlineSVG('svgTrendlineContainer', item);
        }
    }
}

// 近一個月歷史數據明細表格展開 / 隱藏
function toggleMonthHistoryTable() {
    const box = document.getElementById('monthHistoryTableBox');
    if (!box) return;
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';

    if (isHidden && selectedStockSymbol) {
        const item = rawStockData.find(s => s.symbol === selectedStockSymbol);
        if (item) {
            const cleanSymbol = item.symbol.split('.')[0];
            const candles = candlesCache[cleanSymbol] || generateFallbackCandles(item);
            renderMonthHistoryTable(candles, item);
        }
    }
}

// 渲染近一個月歷史數據明細表格 (含 YYYY-MM-DD 日期標示)
function renderMonthHistoryTable(candles, item) {
    const box = document.getElementById('monthHistoryTableBox');
    if (!box) return;

    const slice30 = candles.slice(-30).reverse();
    const inst = item.institutional || {};

    let rowsHtml = '';
    slice30.forEach((c, i) => {
        const prevC = (i < slice30.length - 1) ? slice30[i + 1].close : c.open;
        const diff = Math.round((c.close - prevC) * 100) / 100;
        const diffPct = prevC ? Math.round((diff / prevC) * 10000) / 100 : 0;
        const isUp = diff >= 0;
        const color = isUp ? 'var(--color-bullish)' : 'var(--color-bearish)';
        const sign = isUp ? '+' : '';
        const volLots = Math.round(c.volume || 0);

        // 首日呈現當日證交所官方三大法人買賣超，歷史日呈現成交量與價位動態
        const instLabel = (i === 0) 
            ? `<span style="color:${(inst.total || 0) >= 0 ? 'var(--color-bullish)' : 'var(--color-bearish)'}; font-weight:bold;">${(inst.total || 0) >= 0 ? '+' : ''}${safeVol(inst.total)} 張 (官方)</span>`
            : `<span style="color:var(--text-secondary);">成交量 ${volLots.toLocaleString()} 張</span>`;

        rowsHtml += `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                <td style="font-family:monospace; font-weight:bold; color:var(--text-primary); padding:0.45rem;">${c.time || 'N/A'}</td>
                <td style="font-family:monospace; padding:0.45rem;">$${c.open.toFixed(2)}</td>
                <td style="font-family:monospace; color:var(--color-bullish); padding:0.45rem;">$${c.high.toFixed(2)}</td>
                <td style="font-family:monospace; color:var(--color-bearish); padding:0.45rem;">$${c.low.toFixed(2)}</td>
                <td style="font-family:monospace; font-weight:bold; color:${color}; padding:0.45rem;">$${c.close.toFixed(2)}</td>
                <td style="font-family:monospace; color:${color}; padding:0.45rem;">${sign}${diff.toFixed(2)} (${sign}${diffPct.toFixed(2)}%)</td>
                <td style="font-family:monospace; padding:0.45rem;">${volLots.toLocaleString()} 張</td>
                <td style="font-family:monospace; padding:0.45rem;">${instLabel}</td>
            </tr>
        `;
    });

    box.innerHTML = `
        <div style="font-size:0.85rem; font-weight:bold; color:var(--accent-blue); margin-bottom:0.6rem; display:flex; justify-content:space-between; align-items:center;">
            <span>📅 近 30 個交易日歷史成交數據明細 (包含 YYYY-MM-DD 日期標示)</span>
            <span style="font-size:0.75rem; color:var(--text-secondary);">共 ${slice30.length} 筆資料</span>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
            <thead>
                <tr style="background:rgba(15,23,42,0.85); border-bottom:1px solid var(--border-color); color:var(--text-secondary);">
                    <th style="padding:0.45rem;">日期 (YYYY-MM-DD)</th>
                    <th style="padding:0.45rem;">開盤價</th>
                    <th style="padding:0.45rem;">最高價</th>
                    <th style="padding:0.45rem;">最低價</th>
                    <th style="padding:0.45rem;">收盤價</th>
                    <th style="padding:0.45rem;">漲跌 (幅%)</th>
                    <th style="padding:0.45rem;">當日成交量</th>
                    <th style="padding:0.45rem;">三大法人 / 交易說明</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}


// 全螢幕放大 K 線圖彈窗 Modal
function openFullscreenChart(symbol) {
    const modal = document.getElementById('stockModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    if (!modal || !modalContent) return;

    const item = rawStockData.find(s => s.symbol === symbol);
    if (!item) return;

    const cleanSymbol = item.symbol.split('.')[0];
    const tvMarket = item.market === '上櫃' ? 'TWO' : 'TWSE';
    const currTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    if (modalTitle) modalTitle.innerText = `📈 ${cleanSymbol} ${item.name} 全螢幕 K 線走勢圖`;
    modalContent.innerHTML = `
        <div style="width: 100%; height: 75vh; border-radius: 0.5rem; overflow: hidden; background: #131722;">
            <iframe style="width: 100%; height: 100%; border: none;" src="https://s.tradingview.com/widgetembed/?symbol=${tvMarket}%3A${cleanSymbol}&interval=D&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=131722&theme=${currTheme}&style=1&timezone=Asia%2FTaipei&withdateranges=1"></iframe>
        </div>
    `;
    modal.style.display = 'flex';
}

// 關閉 Modal 彈窗
function closeModal() {
    const modal = document.getElementById('stockModal');
    if (modal) modal.style.display = 'none';
}

// 渲染 即時分析 模式內容 (包含雷達統計與精美卡片網格)
function renderRealtimeAnalysis() {
    const realtimeGrid = document.getElementById('realtimeGrid');
    if (!realtimeGrid) return;

    if (!rawStockData || rawStockData.length === 0) {
        realtimeGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem; color:var(--text-secondary);">尚無即時個股數據，請點擊上方線上更新資料</div>`;
        return;
    }

    // 計算大數據分佈
    const totalCount = rawStockData.length;
    const bullishStocks = rawStockData.filter(s => s.status.includes('買'));
    const bearishStocks = rawStockData.filter(s => s.status.includes('賣'));
    const neutralStocks = rawStockData.filter(s => !s.status.includes('買') && !s.status.includes('賣'));

    // 依成交量排序 top 榜單
    const topVolStocks = [...rawStockData].sort((a, b) => b.volume - a.volume).slice(0, 4);

    let html = `
        <!-- 雷達概覽卡片 1: 盤中多空趨勢水溫 -->
        <div class="radar-card">
            <div class="radar-header">
                <div style="display:flex; align-items:center; gap:0.5rem; font-weight:700;">
                    <span class="pulse-dot"></span> 📊 盤中多空水溫雷達
                </div>
                <span style="font-size:0.8rem; color:var(--text-secondary);">全市場監控: ${totalCount} 檔標的</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:0.75rem; text-align:center;">
                <div style="background:var(--bg-primary); padding:0.75rem; border-radius:0.5rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.78rem; color:var(--color-bullish);">📈 多頭動能</div>
                    <div style="font-size:1.3rem; font-weight:700; color:var(--color-bullish);">${bullishStocks.length} 家</div>
                </div>
                <div style="background:var(--bg-primary); padding:0.75rem; border-radius:0.5rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.78rem; color:var(--color-sideways);">⚖️ 中性整理</div>
                    <div style="font-size:1.3rem; font-weight:700; color:var(--color-sideways);">${neutralStocks.length} 家</div>
                </div>
                <div style="background:var(--bg-primary); padding:0.75rem; border-radius:0.5rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.78rem; color:var(--color-bearish);">📉 空頭避險</div>
                    <div style="font-size:1.3rem; font-weight:700; color:var(--color-bearish);">${bearishStocks.length} 家</div>
                </div>
            </div>
        </div>

        <!-- 雷達概覽卡片 2: 成交量冠軍 Top 焦點 -->
        <div class="radar-card">
            <div class="radar-header">
                <div style="font-weight:700; color:var(--text-primary);">🔥 盤中爆量焦點 Top 標的</div>
                <span style="font-size:0.8rem; color:var(--text-secondary);">張數排序</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                ${topVolStocks.map(s => {
                    const clean = s.symbol.split('.')[0];
                    const isB = s.close >= s.ma60;
                    return `
                        <div style="display:flex; justify-space-between; align-items:center; background:var(--bg-primary); padding:0.45rem 0.75rem; border-radius:0.4rem; cursor:pointer;" onclick="switchMode('daily'); selectStock('${s.symbol}');">
                            <div><strong>${clean} ${s.name}</strong> <span class="badge ${s.badge_class}" style="font-size:0.68rem; padding:0.1rem 0.35rem;">${s.status}</span></div>
                            <div style="font-family:monospace; font-weight:700; color:${isB ? 'var(--color-bullish)' : 'var(--text-primary)'}">$${s.close.toFixed(2)} (${Math.round(s.volume).toLocaleString()}張)</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>

        <!-- 全個股即時快查網格標頭 -->
        <div style="grid-column: 1 / -1; margin-top: 1rem; margin-bottom: -0.5rem; display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:1.15rem; font-weight:700; color:var(--text-primary);">⚡ 監控名單即時數據快查卡片</h3>
            <span style="font-size:0.83rem; color:var(--text-secondary);">點擊任意卡片可連動開啟 K 線走勢圖</span>
        </div>
    `;

    // 渲染全個股即時卡片網格
    rawStockData.forEach(item => {
        const cleanSymbol = item.symbol.split('.')[0];
        const isBullish = item.close >= item.ma60;
        const volStr = Math.round(item.volume).toLocaleString();

        html += `
            <div class="stock-card" onclick="switchMode('daily'); selectStock('${item.symbol}');">
                <div class="card-header">
                    <div>
                        <span class="stock-symbol">${cleanSymbol}</span>
                        <span class="stock-name" style="margin-left:0.3rem;">${item.name}</span>
                    </div>
                    <span class="badge ${item.badge_class}">${item.status}</span>
                </div>
                <div class="card-body">
                    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:0.4rem;">
                        <span class="price-val" style="color:${isBullish ? 'var(--color-bullish)' : 'var(--text-primary)'}">$${item.close.toFixed(2)}</span>
                        <span style="font-size:0.8rem; color:var(--text-secondary);">60MA: $${item.ma60.toFixed(2)}</span>
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.4rem;">
                        ${item.market} · ${item.industry} | 成交量: <strong>${volStr} 張</strong>
                    </div>
                    <div style="font-size:0.78rem; color:var(--accent-blue); display:flex; justify-content:space-between; align-items:center;">
                        <span>🌀 型態: ${item.wave_pattern}</span>
                        <span>查 K 線 ➔</span>
                    </div>
                </div>
            </div>
        `;
    });

    realtimeGrid.innerHTML = html;
}

// 線上重新刷洗資料 API
function triggerRefresh() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerText = '⏳ 資料更新中...';
    }

    fetch('/api/refresh')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                alert('即時篩選資料已成功更新！即將為您重新載入頁面...');
                location.reload();
            } else {
                alert('更新失敗: ' + (data.message || '未知錯誤'));
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                    refreshBtn.innerText = '🔄 線上更新資料';
                }
            }
        })
        .catch(err => {
            alert('請求網路異常: ' + err);
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.innerText = '🔄 線上更新資料';
            }
        });
}

// ─── 安全啟動：無論 DOMContentLoaded 是否已觸發都確保初始化 ───
// 若文件已解析完成 (interactive/complete)，直接呼叫；否則等 DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
