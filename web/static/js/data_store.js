/**
 * web/static/js/data_store.js - 儀表板全域資料與篩選過濾狀態管理
 */

window.rawStockData = [];
window.marketData = [];
window.activeMode = 'daily'; // 'daily' 或 'realtime'
window.activeMarketFilter = 'all'; // 'all', 'twse', 'tpex'
window.activeSignalFilter = 'all'; // 'all', 'bullish', 'neutral', 'bearish'
window.searchQuery = '';
window.selectedStockSymbol = null;
window.activeSortOption = 'score_desc';
window.todayIntradayCache = {};
window.candlesCache = {};

// 輔助函式：安全數字格式化
window.safeFix = (num, dec = 2) => (typeof num === 'number' && !isNaN(num)) ? num.toFixed(dec) : 'N/A';
window.safePrice = (num) => (typeof num === 'number' && !isNaN(num)) ? `$${num.toFixed(2)}` : 'N/A';
window.safeVol = (num) => (typeof num === 'number' && !isNaN(num)) ? Math.round(num).toLocaleString() : '0';

// 市場篩選器點擊處置 (全部 / 上市 / 上櫃)
window.setMarketFilter = function(m, btnEl) {
    window.activeMarketFilter = m;
    const btns = document.querySelectorAll('.filter-group-market .filter-btn');
    btns.forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderDailyReview();
};

// 訊號篩選器點擊處置 (全部 / 買進 / 觀望 / 賣出)
window.setSignalFilter = function(s, btnEl) {
    window.activeSignalFilter = s;
    const btns = document.querySelectorAll('.filter-group-signal .filter-btn');
    btns.forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderDailyReview();
};

// 個股排序選單處置
window.handleSortChange = function(val) {
    window.activeSortOption = val;
    renderDailyReview();
};

// 關鍵字搜尋框輸入即時處理 (代號/名稱/產業)
window.handleSearchInput = function(val) {
    window.searchQuery = (val || '').trim();
    renderDailyReview();
};
