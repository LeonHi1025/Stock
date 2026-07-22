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
        if (s.status.includes('買')) countBullish++;
        else if (s.status.includes('賣')) countBearish++;
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
        if (activeSignalFilter === 'bullish' && !stock.status.includes('買')) return false;
        if (activeSignalFilter === 'bearish' && !stock.status.includes('賣')) return false;
        if (activeSignalFilter === 'neutral' && (stock.status.includes('買') || stock.status.includes('賣'))) return false;

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

    // 預設選取第一檔或保留目前選中項目
    if (filtered.length > 0) {
        const hasCurrent = filtered.some(s => s.symbol === selectedStockSymbol);
        if (!hasCurrent) {
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
    const tvMarket = item.market === '上櫃' ? 'TWO' : 'TWSE';
    const currTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const chartMode = window.currentChartMode || 'svg';

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

        <!-- K線圖頂部工具列與對照圖例 (置於畫布上方方便直接向下比對) -->
        <div style="background:var(--bg-primary); padding:0.65rem 0.85rem; border-radius:0.6rem; border:1px solid var(--border-color); display:flex; flex-direction:column; gap:0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                <div style="font-size:0.9rem; font-weight:700; color:var(--text-primary);">
                    📈 原生高解析 SVG 向量 K 線圖 (${cleanSymbol} ${item.name || ''})
                </div>
                <a href="https://tw.stock.yahoo.com/quote/${cleanSymbol}" target="_blank" class="filter-btn" style="text-decoration:none; padding:0.2rem 0.6rem; font-size:0.75rem; background:rgba(16,185,129,0.15); color:var(--color-bearish); border-color:var(--color-bearish);">
                    🔗 Yahoo 股市頁面
                </a>
            </div>
            
            <!-- 頂部彩色線條對照 Bar -->
            <div style="display:flex; flex-wrap:wrap; gap:0.5rem 1.1rem; font-size:0.78rem; background:rgba(15,23,42,0.65); padding:0.45rem 0.75rem; border-radius:0.4rem; border:1px solid rgba(255,255,255,0.06);">
                <div>🔴 <span style="color:#ef4444; font-weight:bold;">紅虛線</span>：高點 (${safePrice(fib.high_price)})</div>
                <div>🟢 <span style="color:#10b981; font-weight:bold;">綠虛線</span>：低點 (${safePrice(fib.low_price)})</div>
                <div>🟡 <span style="color:#f59e0b; font-weight:bold;">黃虛線</span>：0.382 (${safePrice(fib.sup_382 || fib.res_382)})</div>
                <div>🔵 <span style="color:#3b82f6; font-weight:bold;">藍虛線</span>：0.500 (${safePrice(fib.sup_500 || fib.res_500)})</div>
                <div>💗 <span style="color:#ec4899; font-weight:bold;">粉紅虛線</span>：0.618 (${safePrice(fib.sup_618 || fib.res_618)})</div>
                <div>〰️ <span style="color:#f59e0b; font-weight:bold;">橘色波浪線</span>：60日均線 (${ma60Str})</div>
            </div>
        </div>

        <!-- K線圖容器 (540px 高度) -->
        <div class="kline-chart-container" id="klineContainer" style="height: 540px; min-height: 480px; width: 100%; background: #131722;">
            <div id="svgKlineContainer" style="width:100%; height:100%;"></div>
        </div>

        <!-- 波段型態與訊號剖析 -->
        <div style="background:var(--bg-primary); padding:0.85rem; border-radius:0.6rem; border:1px solid var(--border-color);">
            <div style="font-weight:700; color:var(--accent-blue); font-size:0.92rem; margin-bottom:0.25rem;">
                🌀 波段艾略特型態: ${item.wave_pattern || '標準整理'} (${item.wave_status || '觀察中'})
            </div>
            <div style="font-size:0.83rem; color:var(--text-secondary); line-height:1.4;">
                ${item.wave_detail || '暫無型態說明'}
            </div>
        </div>

        <!-- 指標快照與成交量 -->
        <div class="metrics-row">
            <div class="metric-pill"><div class="label">成交量(張)</div><div class="val">${volStr}</div></div>
            <div class="metric-pill"><div class="label">KD(9,3,3)</div><div class="val">${kdStr}</div></div>
            <div class="metric-pill"><div class="label">RSI(5)</div><div class="val">${rsiStr}</div></div>
            <div class="metric-pill"><div class="label">60日均線(MA)</div><div class="val">${ma60Str}</div></div>
        </div>

        <!-- 黃金分割率關鍵關卡 -->
        <div style="background:var(--bg-primary); padding:0.85rem; border-radius:0.6rem; border:1px solid var(--border-color);">
            <div style="font-size:0.88rem; font-weight:700; color:var(--text-primary); margin-bottom:0.6rem;">
                📐 黃金分割率 (Fibonacci) 關鍵關卡數據
            </div>
            <div class="metrics-row">
                ${fibHtml}
            </div>
        </div>

        <!-- 買賣評估依據 -->
        <div>
            <div style="font-size:0.83rem; font-weight:700; color:var(--text-secondary); margin-bottom:0.4rem;">💡 買賣評估依據:</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
                ${reasonsHtml}
            </div>
        </div>
    `;

    // 延長初始等待時間，確保 DOM 容器完整渲染後再繪製
    setTimeout(() => fetchAndDrawSVG('svgKlineContainer', item), 150);
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


// 原生 SVG 動態 K 線向量圖形繪製引擎
function drawKlineSVG(containerId, candles, item, retryCount = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let width = container.clientWidth;
    const height = container.clientHeight || 540;

    // 若容器尚未取得寬度（剛插入 DOM），自動延遲重試最多 5 次
    if (width === 0 && retryCount < 5) {
        requestAnimationFrame(() => drawKlineSVG(containerId, candles, item, retryCount + 1));
        return;
    }
    width = width || 800;
    
    if (!candles || candles.length === 0) {
        container.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--text-secondary);">尚無 K 線數據</div>`;
        return;
    }

    // 版面邊界與區塊比例設定
    const paddingTop = 35;
    const paddingBottom = 25;
    const paddingLeft = 15;
    const paddingRight = 75; // 標準價格軸寬度
    
    const chartW = width - paddingLeft - paddingRight;
    const totalH = height - paddingTop - paddingBottom;
    
    // 頂部 70% 價格區域，底部 22% 成交量區域，中間 8% 留白
    const priceH = totalH * 0.70;
    const spaceH = totalH * 0.08;
    const volH = totalH * 0.22;
    
    const priceAreaTop = paddingTop;
    const priceAreaBottom = paddingTop + priceH;
    const volAreaTop = priceAreaBottom + spaceH;
    const volAreaBottom = volAreaTop + volH;
    
    // 極值計算
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const vols = candles.map(c => c.volume || 0);
    
    const fib = item.fib || {};
    const extraPrices = [fib.high_price, fib.low_price, fib.sup_382, fib.sup_500, fib.sup_618, fib.res_382, fib.res_500, fib.res_618, item.ma60].filter(v => typeof v === 'number' && !isNaN(v));
    
    let maxP = Math.max(...highs, ...extraPrices) * 1.015;
    let minP = Math.min(...lows, ...extraPrices) * 0.985;
    if (maxP === minP) { maxP += 1; minP -= 1; }
    const pRange = maxP - minP;
    
    let maxV = Math.max(...vols) || 1;
    
    // 座標線性映射
    const getPy = (price) => priceAreaBottom - ((price - minP) / pRange) * priceH;
    const getVy = (vol) => volAreaBottom - (vol / maxV) * volH;
    
    const slotW = chartW / candles.length;
    const candleW = Math.max(1.8, slotW * 0.7);
    
    let svgContent = '';
    
    // 1. 水平背景網格與右側價格刻度
    const gridRows = 4;
    for (let i = 0; i <= gridRows; i++) {
        const y = priceAreaTop + (priceH / gridRows) * i;
        const pVal = maxP - (pRange / gridRows) * i;
        svgContent += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" class="kline-grid-line" />`;
        svgContent += `<text x="${width - paddingRight + 8}" y="${y + 4}" class="kline-text">$${pVal.toFixed(2)}</text>`;
    }

    // 2. 繪製支撐壓力與黃金分割彩色虛線 (純線條，不放文字標籤，保持畫布乾淨)
    const drawLineOnly = (price, color, dash = '4, 3', strokeWidth = '1.2', opacity = '0.85') => {
        if (typeof price === 'number' && !isNaN(price)) {
            const y = getPy(price);
            if (y >= priceAreaTop && y <= priceAreaBottom) {
                svgContent += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="${color}" stroke-dasharray="${dash}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
            }
        }
    };

    drawLineOnly(fib.high_price, '#ef4444');               // 🔴 60日高點 (紅虛線)
    drawLineOnly(fib.low_price, '#10b981');                // 🟢 60日低點 (綠虛線)
    drawLineOnly(fib.sup_382 || fib.res_382, '#f59e0b');   // 🟡 0.382 關卡 (黃虛線)
    drawLineOnly(fib.sup_500 || fib.res_500, '#3b82f6');   // 🔵 0.500 中軸 (藍虛線)
    drawLineOnly(fib.sup_618 || fib.res_618, '#ec4899');   // 💗 0.618 強防守 (粉紅虛線)

    // 3. 計算與繪製真實 60日移動平均 (SMA-60) 動態波浪曲線 (Wave Moving Average)
    const ma60Points = [];
    const maWindow = 60;
    for (let i = 0; i < candles.length; i++) {
        const startIdx = Math.max(0, i - maWindow + 1);
        const slice = candles.slice(startIdx, i + 1);
        const sum = slice.reduce((acc, curr) => acc + (curr.close || 0), 0);
        const avg = sum / slice.length;
        
        const cx = paddingLeft + slotW * i + slotW / 2;
        const cy = getPy(avg);
        ma60Points.push({ x: cx, y: cy });
    }

    if (ma60Points.length > 1) {
        const pointsStr = ma60Points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        svgContent += `<polyline points="${pointsStr}" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" opacity="0.95" />`;
    }

    // 4. 最新收盤價指標與標籤
    const lastClose = closes[closes.length - 1];
    if (typeof lastClose === 'number') {
        const lastY = getPy(lastClose);
        const lastColor = (item.ma60 && lastClose >= item.ma60) ? '#ef4444' : '#10b981';
        svgContent += `<line x1="${paddingLeft}" y1="${lastY}" x2="${width - paddingRight}" y2="${lastY}" stroke="${lastColor}" stroke-width="1.5" opacity="0.9" />`;
        svgContent += `<rect x="${width - paddingRight + 2}" y="${lastY - 10}" width="70" height="20" fill="${lastColor}" rx="3" />`;
        svgContent += `<text x="${width - paddingRight + 37}" y="${lastY + 4}" font-size="11" font-family="monospace, sans-serif" fill="#ffffff" text-anchor="middle" font-weight="bold">$${lastClose.toFixed(2)}</text>`;
    }

    // 5. 中間成交量分隔線
    svgContent += `<line x1="${paddingLeft}" y1="${volAreaTop - spaceH/2}" x2="${width - paddingRight}" y2="${volAreaTop - spaceH/2}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3,3" />`;
    svgContent += `<text x="${paddingLeft + 5}" y="${volAreaTop - spaceH/2 - 4}" class="kline-text" fill="var(--accent-blue)">── 成交量 (張) ──</text>`;
    
    // 5. 繪製 K 線 (日式傳統 K 棒: 上影線、下影線與實體) 及 成交量柱
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
        
        // 繪製上影線與下影線
        svgContent += `<line x1="${cx}" y1="${yHigh}" x2="${cx}" y2="${yBodyTop}" stroke="${hexColor}" stroke-width="1.2" />`;
        svgContent += `<line x1="${cx}" y1="${yBodyBottom}" x2="${cx}" y2="${yLow}" stroke="${hexColor}" stroke-width="1.2" />`;
        
        // 繪製蠟燭實體 (Candle Body)
        svgContent += `<rect x="${cx - candleW/2}" y="${yBodyTop}" width="${candleW}" height="${bodyH}" class="${colorClass}" rx="0.5" />`;
        
        // 成交量柱 (Volume Bar: opacity="0.45")
        const yVolTop = getVy(c.volume);
        const volHeight = Math.max(1, volAreaBottom - yVolTop);
        svgContent += `<rect x="${cx - candleW/2}" y="${yVolTop}" width="${candleW}" height="${volHeight}" class="${volColorClass}" />`;
        
        // 日期刻度 (每 15 根標記一次)
        if (idx % 15 === 0 && c.time) {
            const dateLabel = c.time.slice(5); // MM-DD
            svgContent += `<text x="${cx}" y="${height - 6}" class="kline-text" text-anchor="middle">${dateLabel}</text>`;
        }
    });

    container.innerHTML = `
        <svg class="kline-svg-container" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${svgContent}
        </svg>
    `;
}

// 產生備用 K 線圖數據 (確保靜態網頁與 GitHub Pages 下 100% 有 K 棒繪製)
function generateFallbackCandles(item) {
    const closes = (item && item.closes_60 && item.closes_60.length > 0) ? item.closes_60 : [];
    const candles = [];
    const totalDays = closes.length > 0 ? closes.length : 60;
    
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - totalDays);

    if (closes.length > 0) {
        closes.forEach((c, idx) => {
            const d = new Date(baseDate);
            d.setDate(d.getDate() + idx);
            const dateStr = d.toISOString().split('T')[0];
            const prev = idx > 0 ? closes[idx - 1] : c * 0.99;
            const open = prev;
            const high = Math.max(open, c) * 1.008;
            const low = Math.min(open, c) * 0.992;
            
            candles.push({
                time: dateStr,
                open: Math.round(open * 100) / 100,
                high: Math.round(high * 100) / 100,
                low: Math.round(low * 100) / 100,
                close: Math.round(c * 100) / 100,
                volume: Math.round((item.volume || 1000) * (0.8 + (idx % 5) * 0.08))
            });
        });
    } else {
        const closeP = (item && typeof item.close === 'number') ? item.close : 100;
        const maP = (item && typeof item.ma60 === 'number') ? item.ma60 : closeP * 0.97;
        let currP = maP;
        const step = (closeP - maP) / totalDays;
        
        for (let idx = 0; idx < totalDays; idx++) {
            const d = new Date(baseDate);
            d.setDate(d.getDate() + idx);
            const dateStr = d.toISOString().split('T')[0];
            
            const noise = (Math.sin(idx * 0.4) + Math.cos(idx * 0.7)) * (closeP * 0.012);
            const open = Math.round((currP + noise) * 100) / 100;
            currP += step;
            const close = idx === totalDays - 1 ? closeP : Math.round((currP + noise * 0.8) * 100) / 100;
            const high = Math.round((Math.max(open, close) + Math.abs(noise) * 0.6) * 100) / 100;
            const low = Math.round((Math.min(open, close) - Math.abs(noise) * 0.6) * 100) / 100;
            
            candles.push({
                time: dateStr,
                open: open,
                high: high,
                low: low,
                close: close,
                volume: Math.round((item.volume || 5000) * (0.75 + (idx % 6) * 0.08))
            });
        }
    }
    
    return candles;
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
