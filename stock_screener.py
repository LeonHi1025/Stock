import os
import sys
import json
import datetime
import re
import time
import requests
import pandas as pd
import webbrowser
from io import StringIO
from http.server import BaseHTTPRequestHandler, HTTPServer
from concurrent.futures import ThreadPoolExecutor, as_completed
import warnings
warnings.filterwarnings("ignore")

# 解決 Windows 終端機 CP950 編碼不支援 Emoji 的 UnicodeEncodeError
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

REPORT_FILE = "stock_report.html"
CACHE_FILE = "taiwan_stocks_cache.json"

# 篩選與技術指標設定
MIN_VOLUME_LOTS = 5000       # 最低成交量門檻：5,000 張 (5,000,000 股)
DEVIATION_THRESHOLD = 1.5   # 股價與 60MA 偏離度在 +/- 1.5% 內視為糾結整理
SLOPE_THRESHOLD = 0.05      # 60MA 5日斜率在 +/- 0.05% 內視為走平整理

# 建立 requests.Session 並設定 User-Agent
session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
})

# ==================== 技術指標與波段型態分析模組 ====================

def calculate_ema(prices, period):
    """計算指數移動平均線 (EMA)"""
    if len(prices) < period:
        return [None] * len(prices)
    ema = []
    sma = sum(prices[:period]) / period
    for i in range(len(prices)):
        if i < period - 1:
            ema.append(None)
        elif i == period - 1:
            ema.append(sma)
        else:
            multiplier = 2.0 / (period + 1)
            val = (prices[i] - ema[-1]) * multiplier + ema[-1]
            ema.append(val)
    return ema

def calculate_macd(prices):
    """計算 MACD 指標 (12, 26, 9)"""
    if len(prices) < 26:
        return [None] * len(prices), [None] * len(prices), [None] * len(prices)
        
    ema12 = calculate_ema(prices, 12)
    ema26 = calculate_ema(prices, 26)
    
    dif = []
    for e12, e26 in zip(ema12, ema26):
        if e12 is None or e26 is None:
            dif.append(None)
        else:
            dif.append(e12 - e26)
            
    dif_valid = [x for x in dif if x is not None]
    if len(dif_valid) < 9:
        return dif, [None] * len(prices), [None] * len(prices)
        
    dea_valid = calculate_ema(dif_valid, 9)
    dea = [None] * (len(prices) - len(dea_valid)) + dea_valid
    
    macd_hist = []
    for d, s in zip(dif, dea):
        if d is None or s is None:
            macd_hist.append(None)
        else:
            macd_hist.append(d - s)
            
    return dif, dea, macd_hist

def calculate_rsi(prices, period=5):
    """計算 RSI 指標"""
    if len(prices) < period + 1:
        return [None] * len(prices)
        
    rsi = [None] * len(prices)
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    
    gains = [d if d > 0 else 0.0 for d in deltas]
    losses = [-d if d < 0 else 0.0 for d in deltas]
    
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    
    if avg_loss == 0:
        rsi[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi[period] = 100.0 - (100.0 / (1.0 + rs))
        
    for i in range(period + 1, len(prices)):
        delta = deltas[i-1]
        gain = delta if delta > 0 else 0.0
        loss = -delta if delta < 0 else 0.0
        
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        
        if avg_loss == 0:
            rsi[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[i] = 100.0 - (100.0 / (1.0 + rs))
            
    return rsi

def calculate_kd(prices, period=9):
    """計算 KD 指標 (9, 3, 3)"""
    if len(prices) < period:
        return [None] * len(prices), [None] * len(prices)
        
    k_vals = []
    d_vals = []
    
    k = 50.0
    d = 50.0
    
    for i in range(len(prices)):
        if i < period - 1:
            k_vals.append(None)
            d_vals.append(None)
        else:
            window = prices[i - period + 1 : i + 1]
            high_c = max(window)
            low_c = min(window)
            close_c = prices[i]
            
            if high_c == low_c:
                rsv = 50.0
            else:
                rsv = (close_c - low_c) / (high_c - low_c) * 100.0
                
            k = (2.0 / 3.0) * k + (1.0 / 3.0) * rsv
            d = (2.0 / 3.0) * d + (1.0 / 3.0) * k
            k_vals.append(k)
            d_vals.append(d)
            
    return k_vals, d_vals

def find_peaks_and_valleys(prices, window=4):
    """尋找股價歷史中的局部波段高點 (Peaks) 與低點 (Valleys) 用於型態分析"""
    peaks = []
    valleys = []
    
    n = len(prices)
    for i in range(window, n - window):
        sub = prices[i - window : i + window + 1]
        val = prices[i]
        
        # 局部高點
        if val == max(sub):
            if not peaks or peaks[-1][1] != val:
                peaks.append((i, val))
        # 局部低點
        if val == min(sub):
            if not valleys or valleys[-1][1] != val:
                valleys.append((i, val))
                
    return peaks, valleys

def analyze_wave_patterns(prices):
    """分析股價當前的波段型態（頭肩頂、M頭、W底、楔型、旗型、箱型等經典技術型態）"""
    n = len(prices)
    if n < 30:
        return "資料不足", "N/A", "N/A"
        
    peaks, valleys = find_peaks_and_valleys(prices, window=4)
    latest_price = prices[-1]
    
    # 提前處理無極值情況
    if len(peaks) == 0 or len(valleys) == 0:
        if latest_price > prices[-5]:
            return "震盪偏多", "短線反彈段", "短線跌深反彈，偏多看待"
        else:
            return "震盪偏空", "短線修正段", "短線高檔修正，偏空看待"

    p_prices = [p[1] for p in peaks]
    v_prices = [v[1] for v in valleys]
    p_indices = [p[0] for p in peaks]
    v_indices = [v[0] for v in valleys]
    
    # ==================== 艾略特波段 (Elliott Wave ABC) 判定核心 ====================
    # 尋找近 50 天的波段最高點作為多頭起點 (Wave 5 Peak)
    recent_len = min(50, len(prices))
    recent_closes = prices[-recent_len:]
    max_price = max(recent_closes)
    max_idx = len(prices) - recent_len + recent_closes.index(max_price)
    
    # 找出最高點之後的所有 valley 與 peak
    valleys_after_peak = [v for v in valleys if v[0] > max_idx]
    
    if len(valleys_after_peak) == 0:
        # 最高點後沒有任何確認的谷值，代表仍在 A 波下跌中
        if latest_price < max_price * 0.980:
            return "多頭拉回", "A波回測中", "頂部轉折拉回 A 波修正，防範跌勢擴大 ⚠️"
    else:
        # 取最高點後第一個落底谷值作為 A 波底 (V_A)
        v_A = valleys_after_peak[0]
        v_A_idx, v_A_price = v_A[0], v_A[1]
        
        # 尋找 V_A 之後的峰值 (作為 B 波頂)
        peaks_after_valley = [p for p in peaks if p[0] > v_A_idx]
        
        if len(peaks_after_valley) == 0:
            # 已經有落底谷值且目前高於谷底，即為 A 波跌勢結束、B 波反彈展開！
            if latest_price > v_A_price:
                return "多頭反彈", "B波反彈中", "A波修正落底，反彈波 B 展開中 📈"
        else:
            # 已經有確認的 B 波高點 (P_B)
            p_B = peaks_after_valley[0]
            p_B_idx, p_B_price = p_B[0], p_B[1]
            
            # 從 P_B 高點再次往下跌，即進入 C 波修正
            if latest_price < p_B_price:
                if latest_price < v_A_price:
                    return "空頭格局", "C波下跌中", "跌破A波低點，進行C波主跌段 📉"
                else:
                    return "偏空整理", "C波醖釀中", "B波反彈結束，防範C波主跌段 ⚠️"
    # ==============================================================================

    # 1. 偵測「頭肩頂 (Head & Shoulders Top)」
    if len(peaks) >= 3 and len(valleys) >= 2:
        p1, p2, p3 = p_prices[-3], p_prices[-2], p_prices[-1]
        v1, v2 = v_prices[-2], v_prices[-1]
        p1_idx, p2_idx, p3_idx = p_indices[-3], p_indices[-2], p_indices[-1]
        v1_idx, v2_idx = v_indices[-2], v_indices[-1]
        
        if p1_idx < v1_idx < p2_idx < v2_idx < p3_idx:
            if p2 > p1 and p2 > p3 and abs(p1 - p3) / p1 < 0.08:
                neckline = min(v1, v2)
                if latest_price < neckline:
                    return "頂部確立", "頭肩頂型態", "已跌破頸線，防轉空 📉"
                else:
                    return "頂部警告", "頭肩頂型態", "右肩成型中，關注頸線 ⚠️"

    # 2. 偵測「M頭 (Double Top)」
    if len(peaks) >= 2 and len(valleys) >= 1:
        p1, p2 = p_prices[-2], p_prices[-1]
        v1 = v_prices[-1]
        p1_idx, p2_idx = p_indices[-2], p_indices[-1]
        v1_idx = v_indices[-1]
        
        if p1_idx < v1_idx < p2_idx:
            if abs(p1 - p2) / p1 < 0.03: # 兩峰高度相差在 3% 內
                if latest_price < v1:
                    return "頂部確立", "M頭型態", "已跌破頸線，確認轉空 📉"
                else:
                    return "頂部警告", "M頭型態", "右頭已完成，防跌破頸線 ⚠️"

    # 3. 偵測「W底 (Double Bottom)」
    if len(valleys) >= 2 and len(peaks) >= 1:
        v1, v2 = v_prices[-2], v_prices[-1]
        p1 = p_prices[-1]
        v1_idx, v2_idx = v_indices[-2], v_indices[-1]
        p1_idx = p_indices[-1]
        
        if v1_idx < p1_idx < v2_idx:
            if abs(v1 - v2) / v1 < 0.03: # 兩底深度相差在 3% 內
                if latest_price > p1:
                    return "底部確立", "W底型態", "已突破頸線，轉多噴發 🚀"
                else:
                    return "底部信號", "W底型態", "右底反彈中，挑戰頸線 📈"

    # 4. 偵測「楔型整理 (Wedges)」
    if len(peaks) >= 2 and len(valleys) >= 2:
        p1, p2 = p_prices[-2], p_prices[-1]
        v1, v2 = v_prices[-2], v_prices[-1]
        p_slope = p2 - p1
        v_slope = v2 - v1
        
        # 上升楔型：兩線皆揚，但下軌（谷）斜率大於上軌（峰），收斂向上，高檔易跌
        if p_slope > 0 and v_slope > 0:
            if v_slope > p_slope:
                return "高檔整理", "上升楔型", "收斂向上，防高檔下折 ⚠️"
        # 下跌楔型：兩線皆墜，但上軌（峰）跌幅大於下軌（谷），收斂向下，易突破
        elif p_slope < 0 and v_slope < 0:
            if abs(p_slope) > abs(v_slope):
                return "低檔整理", "下跌楔型", "收斂向下，蓄勢向上突破 📈"

    # 5. 偵測「上升旗型整理 (Bull Flag)」
    if len(prices) >= 20:
        price_15d_ago = prices[-15]
        flagpole_gain = (latest_price - price_15d_ago) / price_15d_ago * 100.0
        
        recent_5d = prices[-5:]
        is_pullback = recent_5d[-1] < max(recent_5d)
        
        # 15天內大漲超過 15% (旗竿)，近 5 天呈現緊湊的小幅拉回且不跌破旗竿高低點的 1/2
        if flagpole_gain > 15.0 and is_pullback and min(recent_5d) > (price_15d_ago + latest_price) / 2.0:
            return "多頭整理", "上升旗型", "多頭旗部回檔，等待突破 📈"

    # 6. 偵測「矩形箱型整理 (Rectangle / Box)」
    if len(peaks) >= 2 and len(valleys) >= 2:
        p1, p2 = p_prices[-2], p_prices[-1]
        v1, v2 = v_prices[-2], v_prices[-1]
        if abs(p1 - p2) / p1 < 0.04 and abs(v1 - v2) / v1 < 0.04:
            return "區間整理", "矩形箱型", "上下軌水平區間震盪 ⚖️"

    # 7. 偵測「主升段第三波 (Wave 3)」
    if len(valleys) >= 2 and len(peaks) >= 1:
        v1, v2 = v_prices[-2], v_prices[-1]
        p1 = p_prices[-1]
        v1_idx, v2_idx = v_indices[-2], v_indices[-1]
        p1_idx = p_indices[-1]
        
        if v1_idx < p1_idx < v2_idx:
            if v2 > v1:
                if latest_price > p1:
                    return "強勢多頭", "主升段第三波", "突破第一波前高，強勢主升 🚀"
                elif v2 < latest_price <= p1:
                    if latest_price > prices[-3]:
                        return "多頭醞釀", "主升前置波", "第二波拉回結束，正發動上攻"
                    else:
                        return "多頭整理", "第二波拉回", "波段高點後拉回修正整理"

    # 9. 基本通道
    if len(peaks) >= 2 and len(valleys) >= 2:
        p_rising = p_prices[-1] > p_prices[-2]
        v_rising = v_prices[-1] > v_prices[-2]
        if p_rising and v_rising:
            return "多頭趨勢", "上升通道", "底部與頭部皆一波比一波高"
        elif not p_rising and not v_rising:
            return "空頭趨勢", "下跌通道", "底部與頭部皆一波比一波低"
            
    if latest_price > prices[-5]:
        return "震盪偏多", "短線反彈段", "短線跌深反彈，偏多看待"
    else:
        return "震盪偏空", "短線修正段", "短線高檔修正，偏空看待"

def determine_signal(prices, k_vals, d_vals, rsi5_vals, macd_dif, macd_dea, macd_hist, latest_close, ma60, slope_pct):
    """綜合 60MA、KD交叉/背離、RSI(5)黃金交叉50/背離、MACD 進行買賣判斷評分"""
    score = 0.0
    signals = []
    
    # 1. 60MA 趨勢判定
    if latest_close > ma60 and slope_pct > 0.05:
        score += 1.0
        signals.append("均線多頭 (+1.0)")
    elif latest_close < ma60 and slope_pct < -0.05:
        score -= 1.0
        signals.append("均線空頭 (-1.0)")
        
    # 2. KD 交叉與超買超賣判定
    k_curr, d_curr = k_vals[-1], d_vals[-1]
    k_prev, d_prev = k_vals[-2], d_vals[-2] if len(k_vals) > 1 else (None, None)
    
    if k_curr is not None and d_curr is not None:
        if k_prev is not None and d_prev is not None:
            # 低檔黃金交叉
            if k_prev <= d_prev and k_curr > d_curr:
                if k_curr < 40:
                    score += 1.5
                    signals.append("KD低檔黃金交叉 (+1.5)")
                else:
                    score += 1.0
                    signals.append("KD黃金交叉 (+1.0)")
            # 高檔死亡交叉
            elif k_prev >= d_prev and k_curr < d_curr:
                if k_curr > 60:
                    score -= 1.5
                    signals.append("KD高檔死亡交叉 (-1.5)")
                else:
                    score -= 1.0
                    signals.append("KD死亡交叉 (-1.0)")
        
        # 超買超賣區間
        if k_curr > 80:
            score -= 0.5
            signals.append("KD超買區 (-0.5)")
        elif k_curr < 20:
            score += 0.5
            signals.append("KD超賣區 (+0.5)")
            
    # 3. RSI(5) 區間與 50 穿越判定 (買點/賣點)
    rsi5_curr = rsi5_vals[-1]
    rsi5_prev = rsi5_vals[-2] if len(rsi5_vals) > 1 else None
    
    if rsi5_curr is not None:
        if rsi5_curr > 70:
            score -= 1.0
            signals.append("RSI(5)過熱 (-1.0)")
        elif rsi5_curr < 30:
            score += 1.0
            signals.append("RSI(5)低估 (+1.0)")
            
        if rsi5_prev is not None:
            if rsi5_prev < 50.0 and rsi5_curr >= 50.0:
                score += 1.2
                signals.append("RSI(5)突破50買點 (+1.2)")
            elif rsi5_prev > 50.0 and rsi5_curr <= 50.0:
                score -= 1.2
                signals.append("RSI(5)跌破50賣點 (-1.2)")
            
    # 4. 指標與價格「背離 (Divergence)」偵測
    if len(prices) >= 9 and rsi5_vals[-9] is not None and k_vals[-9] is not None:
        p_curr, p_prev = latest_close, prices[-9]
        rsi_c, rsi_p = rsi5_curr, rsi5_vals[-9]
        k_c, k_p = k_curr, k_vals[-9]
        
        price_change_pct = (p_curr - p_prev) / p_prev * 100.0
        rsi_diff = rsi_c - rsi_p
        k_diff = k_c - k_p
        
        # 熊市高檔背離 (股價突破/上漲，但指標下滑) -> 可能成頭部
        if price_change_pct > 3.0:
            if rsi_diff < -15.0:
                score -= 1.5
                signals.append("RSI高檔背離(警戒頭部) (-1.5)")
            if k_diff < -15.0:
                score -= 1.0
                signals.append("KD高檔背離 (-1.0)")
                
        # 牛市低檔背離 (股價破底/下跌，但指標上揚) -> 可能成底部
        elif price_change_pct < -3.0:
            if rsi_diff > 15.0:
                score += 1.5
                signals.append("RSI低檔背離(底部訊號) (+1.5)")
            if k_diff > 15.0:
                score += 1.0
                signals.append("KD低檔背離 (+1.0)")

    # 5. MACD 交叉與柱狀體力道
    osc_curr = macd_hist[-1]
    osc_prev = macd_hist[-2] if len(macd_hist) > 1 else None
    
    if osc_curr is not None:
        if osc_prev is not None:
            if osc_prev <= 0 and osc_curr > 0:
                score += 1.0
                signals.append("MACD多頭交叉 (+1.0)")
            elif osc_prev >= 0 and osc_curr < 0:
                score -= 1.0
                signals.append("MACD空頭交叉 (-1.0)")
                
        if osc_curr > 0:
            score += 0.5
        else:
            score -= 0.5
            
    # 綜合評級
    if score >= 2.0:
        recommendation = "強勢買入"
        badge_class = "badge-bullish"
    elif 0.5 <= score < 2.0:
        recommendation = "偏多買入"
        badge_class = "badge-bullish-mild"
    elif -0.5 < score < 0.5:
        recommendation = "中性觀望"
        badge_class = "badge-sideways"
    elif -2.0 < score <= -0.5:
        recommendation = "偏空賣出"
        badge_class = "badge-bearish-mild"
    else:
        recommendation = "強勢賣出"
        badge_class = "badge-bearish"
        
    return recommendation, score, signals, badge_class

# ====================================================================

def fetch_taiwan_stock_list():
    """從證交所開放網頁動態獲取所有上市與上櫃的普通股清單，若失敗則讀取快取"""
    force_update = "/api/refresh" in "".join(sys.argv) or not os.path.exists(CACHE_FILE)
    
    if not force_update and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                stocks = json.load(f)
                if stocks:
                    print(f"成功從本機快取 {CACHE_FILE} 載入 {len(stocks)} 檔普通股清單。")
                    return stocks
        except Exception:
            pass

    print("正在自證交所與櫃買中心下載最新普通股清單...")
    url_listed = "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2" # 上市
    url_otc = "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4"    # 上櫃
    
    stocks = []
    
    for url, suffix in [(url_listed, ".TW"), (url_otc, ".TWO")]:
        market_type = "上市" if suffix == ".TW" else "上櫃"
        response = None
        for attempt in range(3):
            try:
                response = session.get(url, timeout=30)
                if response.status_code == 200:
                    break
            except Exception as e:
                if attempt == 2:
                    print(f" ❌ 獲取 {market_type} 清單連線超時: {e}")
                time.sleep(2)
                
        if response and response.status_code == 200:
            try:
                response.encoding = 'big5'
                dfs = pd.read_html(StringIO(response.text), flavor='lxml')
                df = dfs[0]
                df.columns = df.iloc[0]
                df = df.iloc[1:]
                
                count_before = len(stocks)
                for _, row in df.iterrows():
                    symbol_name = str(row.iloc[0])
                    cfi_code = str(row.iloc[5])
                    industry = str(row.iloc[4]) # 產業別
                    
                    if cfi_code.strip() == 'ESVUFR':
                        parts = re.split(r'\s+', symbol_name.strip())
                        if len(parts) >= 2:
                            symbol = parts[0]
                            name = parts[1]
                            if symbol.isdigit() and len(symbol) == 4:
                                stocks.append({
                                    "symbol": f"{symbol}{suffix}",
                                    "name": name,
                                    "market": market_type,
                                    "industry": industry.strip()
                                })
                print(f"成功下載 {market_type} 普通股清單，篩選出 {len(stocks) - count_before} 檔。")
            except Exception as e:
                print(f"解析 {market_type} 清單失敗: {e}")
                
    if stocks:
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(stocks, f, ensure_ascii=False, indent=2)
            print(f"已更新本機股票清單快取至 {CACHE_FILE}。")
        except Exception:
            pass
    elif os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                stocks = json.load(f)
                if stocks:
                    print(f"網路連線失敗，成功由舊快取載入 {len(stocks)} 檔股票。")
        except Exception:
            pass
            
    if not stocks:
        print("警告：無法自網路獲取清單且無本機快取，將使用精簡備用股票清單。")
        stocks = [
            {"symbol": "2330.TW", "name": "台積電", "market": "上市", "industry": "半導體業"},
            {"symbol": "2317.TW", "name": "鴻海", "market": "上市", "industry": "其他電子業"},
            {"symbol": "2454.TW", "name": "聯發科", "market": "上市", "industry": "半導體業"},
            {"symbol": "2308.TW", "name": "台達電", "market": "上市", "industry": "電子零組件業"},
            {"symbol": "2881.TW", "name": "富邦金", "market": "上市", "industry": "金融保險業"},
            {"symbol": "2882.TW", "name": "國泰金", "market": "上市", "industry": "金融保險業"},
            {"symbol": "2603.TW", "name": "長榮", "market": "上市", "industry": "航運業"},
            {"symbol": "2382.TW", "name": "廣達", "market": "上市", "industry": "電腦及週邊設備業"},
            {"symbol": "3008.TW", "name": "大立光", "market": "上市", "industry": "光電業"}
        ]
        
    return stocks

def fetch_spark_chunk(chunk):
    """下載單一批次（最多20檔）的股票資訊並進行多重指標與波段型態分析"""
    symbols_str = ",".join([s["symbol"] for s in chunk])
    url = f"https://query1.finance.yahoo.com/v7/finance/spark?symbols={symbols_str}&range=6mo&interval=1d"
    
    chunk_results = []
    try:
        response = session.get(url, timeout=10)
        if response.status_code != 200:
            return chunk_results
            
        data = response.json()
        spark_result = data.get("spark", {}).get("result", [])
        
        for item in spark_result:
            symbol = item.get("symbol")
            stock_info = next((s for s in chunk if s["symbol"] == symbol), None)
            if not stock_info:
                continue
            name = stock_info["name"]
            market = stock_info["market"]
            industry = stock_info.get("industry", "未分類")
            
            resp_list = item.get("response", [])
            if not resp_list:
                continue
            resp = resp_list[0]
            
            timestamps = resp.get("timestamp", [])
            meta = resp.get("meta", {})
            quote = resp.get("indicators", {}).get("quote", [{}])[0]
            close_prices = quote.get("close", [])
            
            if not timestamps or not close_prices:
                continue
            
            # 對齊股價與時間戳記，剔除為 None 的值
            valid_closes = []
            valid_timestamps = []
            for ts, cl in zip(timestamps, close_prices):
                if cl is not None:
                    valid_closes.append(cl)
                    valid_timestamps.append(ts)
                    
            if len(valid_closes) < 60:
                continue
                
            latest_close = valid_closes[-1]
            latest_vol = meta.get("regularMarketVolume", 0)
            latest_vol_lots = latest_vol / 1000.0
            
            # 1. 5000張量能過濾
            if latest_vol_lots < MIN_VOLUME_LOTS:
                continue
                
            # 2. 計算 60MA
            ma60 = sum(valid_closes[-60:]) / 60.0
            ma60_prev_slice = valid_closes[-64:-4] if len(valid_closes) >= 64 else valid_closes[-60:]
            ma60_prev = sum(ma60_prev_slice) / len(ma60_prev_slice)
            slope_pct = (ma60 - ma60_prev) / ma60_prev * 100.0 if ma60_prev > 0.0 else 0.0
            
            # 3. 計算技術指標 KD, RSI(5), MACD
            k_vals, d_vals = calculate_kd(valid_closes, 9)
            rsi5_vals = calculate_rsi(valid_closes, 5)
            macd_dif, macd_dea, macd_hist = calculate_macd(valid_closes)
            
            # 4. 分析波段與型態 (拆分為 狀態、型態名、詳細解析)
            wave_status, wave_pattern, wave_detail = analyze_wave_patterns(valid_closes)
            
            # 5. 綜合指標買賣判斷
            recommendation, score, signals_list, badge_class = determine_signal(
                valid_closes, k_vals, d_vals, rsi5_vals, macd_dif, macd_dea, macd_hist,
                latest_close, ma60, slope_pct
            )
            
            # 5.1 計算 20 日高低點作為短期支撐與壓力
            recent_20_closes = valid_closes[-20:]
            support_20d = min(recent_20_closes)
            resistance_20d = max(recent_20_closes)
            
            # 6. 計算黃金切割率 (精準對齊 60 日最高點/最低點的發生日期)
            window_closes = valid_closes[-60:]
            window_timestamps = valid_timestamps[-60:]
            
            high_60d = max(window_closes)
            low_60d = min(window_closes)
            diff_60d = high_60d - low_60d
            
            high_idx = window_closes.index(high_60d)
            low_idx = window_closes.index(low_60d)
            
            # 轉換為 Unix 到 MM/DD
            high_ts = window_timestamps[high_idx]
            low_ts = window_timestamps[low_idx]
            high_date = datetime.datetime.fromtimestamp(high_ts).strftime("%m/%d")
            low_date = datetime.datetime.fromtimestamp(low_ts).strftime("%m/%d")
            
            fib_levels = {
                "high_price": high_60d,
                "low_price": low_60d,
                "high_date": high_date,
                "low_date": low_date
            }
            
            if latest_close >= ma60:
                fib_levels["type"] = "多頭"
                fib_levels["sup_382"] = high_60d - 0.382 * diff_60d
                fib_levels["sup_500"] = high_60d - 0.500 * diff_60d
                fib_levels["sup_618"] = high_60d - 0.618 * diff_60d
                fib_levels["tgt_1382"] = low_60d + 1.382 * diff_60d
                fib_levels["tgt_1618"] = low_60d + 1.618 * diff_60d
            else:
                fib_levels["type"] = "空頭"
                fib_levels["res_382"] = low_60d + 0.382 * diff_60d
                fib_levels["res_500"] = low_60d + 0.500 * diff_60d
                fib_levels["res_618"] = low_60d + 0.618 * diff_60d
                fib_levels["tgt_1382"] = high_60d - 1.382 * diff_60d
                fib_levels["tgt_1618"] = high_60d - 1.618 * diff_60d
            
            chunk_results.append({
                "symbol": symbol,
                "name": name,
                "market": market,
                "industry": industry,
                "close": latest_close,
                "support": support_20d,
                "resistance": resistance_20d,
                "ma60": ma60,
                "volume": latest_vol_lots,
                "kd_k": k_vals[-1],
                "kd_d": d_vals[-1],
                "rsi5": rsi5_vals[-1],
                "macd_dif": macd_dif[-1],
                "macd_dea": macd_dea[-1],
                "macd_osc": macd_hist[-1],
                "wave_status": wave_status,
                "wave_pattern": wave_pattern,
                "wave_detail": wave_detail,
                "fib": fib_levels,
                "status": recommendation,
                "score": score,
                "reason": signals_list,
                "badge_class": badge_class,
                "closes_60": [round(c, 2) for c in valid_closes[-60:]]
            })
    except Exception:
        pass
    return chunk_results

def screen_stocks_bulk_parallel(stocks):
    """將清單拆分為每組 20 檔（API限制），並平行下載與運算，防鎖 IP 且效率極高"""
    results = []
    total = len(stocks)
    print(f"\n開始下載股價並進行多空篩選 (批次大小: 20，最低成交量限制: {MIN_VOLUME_LOTS}張)...")
    
    chunk_size = 20
    chunks = [stocks[i:i + chunk_size] for i in range(0, total, chunk_size)]
    
    completed = 0
    total_chunks = len(chunks)
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_spark_chunk, chunk): chunk for chunk in chunks}
        
        for future in as_completed(futures):
            completed += 1
            res = future.result()
            if res:
                results.extend(res)
                
            if completed % 10 == 0 or completed == total_chunks:
                progress_pct = completed / total_chunks * 100
                print(f"處理批次進度: {completed}/{total_chunks} ({progress_pct:.1f}%) | 篩選出符合個股: {len(results)} 檔")
            
            time.sleep(0.05)
                
    return results

def print_console_report(results):
    """在終端機列印篩選排行"""
    print("\n" + "="*125)
    print(f" 🎯 台灣上市上櫃股票多空/型態指標買賣分析 (量 > {MIN_VOLUME_LOTS}張) - {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*125)
    
    if not results:
        print("沒有股票符合成交量篩選條件。")
        print("="*125)
        return
        
    sorted_results = sorted(results, key=lambda x: x["score"], reverse=True)
    
    header = f"{'代碼':<8} {'名稱':<8} {'類股':<10} {'收盤':<8} {'60MA':<8} {'KD(9,3,3)':<14} {'RSI(5)':<10} {'量(張)':<8} {'建議':<8} {'波段型態':<20} {'主要買賣訊號':<20}"
    print(header)
    print("-" * 125)
    
    for r in sorted_results[:60]:
        symbol = r["symbol"].split(".")[0]
        name = r["name"]
        industry = r["industry"][:6]
        close_str = f"{r['close']:.2f}"
        ma60_str = f"{r['ma60']:.2f}"
        
        kd_str = f"K:{r['kd_k']:.1f}/D:{r['kd_d']:.1f}" if r['kd_k'] is not None else "N/A"
        rsi_str = f"{r['rsi5']:.1f}" if r['rsi5'] is not None else "N/A"
        
        vol_str = f"{int(r['volume']):,}"
        recommendation = r["status"]
        wave_pattern = f"{r['wave_pattern']} ({r['wave_detail']})"[:14]
        reason = " | ".join(r["reason"]) if r["reason"] else "持平"
        
        print(f"{symbol:<8} {name:<8} {industry:<10} {close_str:<8} {ma60_str:<8} {kd_str:<14} {rsi_str:<10} {vol_str:<8} {recommendation:<8} {wave_pattern:<20} {reason:<20}")
        
    if len(sorted_results) > 60:
        print(f"... 還有 {len(sorted_results) - 60} 檔符合量能個股，已完整寫入網頁儀表板 {REPORT_FILE} 中。")
    print("="*125)

def fetch_market_data():
    """獲取大盤加權指數與台指期行情"""
    market_info = {
        "taiex": {"price": None, "change": None, "pct": None},
        "txf_day": {"price": None, "change": None, "pct": None},
        "txf_full": {"price": None, "change": None, "pct": None}
    }
    
    try:
        url = "https://query1.finance.yahoo.com/v7/finance/spark?symbols=^TWII&range=1d&interval=1m"
        response = session.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            result = data.get("spark", {}).get("result", [])
            if result:
                resp_list = result[0].get("response", [])
                if resp_list:
                    meta = resp_list[0].get("meta", {})
                    price = meta.get("regularMarketPrice")
                    prev_close = meta.get("chartPreviousClose")
                    if price is not None and prev_close is not None and prev_close != 0:
                        change = price - prev_close
                        pct = (change / prev_close) * 100.0
                        market_info["taiex"] = {
                            "price": price,
                            "change": change,
                            "pct": pct
                        }
    except Exception as e:
        print(f"無法抓取加權指數: {e}")

    try:
        url = "https://openapi.taifex.com.tw/v1/DailyMarketReportFut"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            txf_items = [x for x in data if x.get("Contract") == "TXF"]
            if txf_items:
                near_month = txf_items[0].get("ContractMonth(Week)")
                near_items = [x for x in txf_items if x.get("ContractMonth(Week)") == near_month]
                
                for item in near_items:
                    session_type = item.get("TradingSession", "")
                    try:
                        last_val = item.get("Last")
                        change_val = item.get("Change")
                        pct_val = item.get("%")
                        
                        if last_val and last_val != '-' and change_val and change_val != '-':
                            price = float(last_val)
                            change = float(change_val)
                            pct = float(pct_val.replace("%", "")) if pct_val else 0.0
                        else:
                            continue
                    except ValueError:
                        continue
                        
                    if session_type == "一般":
                        market_info["txf_day"] = {"price": price, "change": change, "pct": pct}
                    elif session_type == "盤後":
                        market_info["txf_full"] = {"price": price, "change": change, "pct": pct}
    except Exception as e:
        print(f"無法抓取期交所台指期資料: {e}")
        
    return market_info

def generate_html_report(results):
    """使用模組化模板 (web/templates) 產生互動式 HTML 網頁儀表板"""
    now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    results_cache_file = "last_results.json"
    if results:
        try:
            with open(results_cache_file, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
            
    market_info = fetch_market_data()
    market_json = json.dumps(market_info, ensure_ascii=False)
    results_json = json.dumps(results, ensure_ascii=False)
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    template_dir = os.path.join(base_dir, "web", "templates")
    base_path = os.path.join(template_dir, "base.html")
    daily_path = os.path.join(template_dir, "daily_review.html")
    realtime_path = os.path.join(template_dir, "realtime_analysis.html")
    
    daily_content = ""
    realtime_content = ""
    
    if os.path.exists(daily_path):
        with open(daily_path, "r", encoding="utf-8") as f:
            daily_content = f.read()
            
    if os.path.exists(realtime_path):
        with open(realtime_path, "r", encoding="utf-8") as f:
            realtime_content = f.read()
            
    if os.path.exists(base_path):
        with open(base_path, "r", encoding="utf-8") as f:
            html_content = f.read()
            
        html_content = html_content.replace("__NOW_STR__", now_str)                                    .replace("__MARKET_JSON__", market_json)                                    .replace("__RESULTS_JSON__", results_json)                                    .replace("__DAILY_REVIEW_CONTENT__", daily_content)                                    .replace("__REALTIME_ANALYSIS_CONTENT__", realtime_content)
        
        with open(REPORT_FILE, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"\n互動式網頁報告已成功產出: {REPORT_FILE}")

# 富果 (Fugle) API Token 與後端 Memory Cache (快取 10 秒防爆)
FUGLE_API_KEYS = [
    "4b417396-a9f8-4bd6-80fe-67094586c0f9",
    "749d0706-f3bd-4aa1-b8b1-750bcf489c6d"
]
KLINE_MEMORY_CACHE = {}  # { symbol: (timestamp, data_dict) }
CACHE_TTL = 10           # 相同的股票請求保留 10 秒快取

def fetch_kline_api(symbol):
    """後端 K 線 API (含 Fugle API、Memory Cache 快取與備用數據源)"""
    clean_sym = symbol.split('.')[0]
    now_ts = time.time()
    
    # 1. 檢查 Memory Cache (對相同的股票請求保留 10 秒快取)
    if clean_sym in KLINE_MEMORY_CACHE:
        cached_ts, cached_data = KLINE_MEMORY_CACHE[clean_sym]
        if now_ts - cached_ts < CACHE_TTL:
            return cached_data
            
    candles = []
    
    # 2. 試圖向 富果 (Fugle) API 請求
    today = datetime.date.today()
    from_date = (today - datetime.timedelta(days=120)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")
    
    for key in FUGLE_API_KEYS:
        try:
            url = f"https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/{clean_sym}?from={from_date}&to={to_date}&fields=open,high,low,close,volume"
            resp = requests.get(url, headers={"X-API-KEY": key}, timeout=3)
            if resp.status_code == 200:
                raw_candles = resp.json().get("candles", [])
                for c in reversed(raw_candles):
                    candles.append({
                        "time": c.get("date"),
                        "open": float(c.get("open")),
                        "high": float(c.get("high")),
                        "low": float(c.get("low")),
                        "close": float(c.get("close")),
                        "volume": round(float(c.get("volume", 0)) / 1000.0, 1)
                    })
                if candles:
                    break
        except Exception:
            pass
            
    # 3. 備用 API: 使用全域 session 呼叫 Yahoo Chart API 取得真實 OHLC 數據
    if not candles:
        try:
            y_symbol = f"{clean_sym}.TW" if not clean_sym.startswith("6") and not clean_sym.startswith("8") else f"{clean_sym}.TWO"
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{y_symbol}?range=6mo&interval=1d"
            resp = session.get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                result = data.get("chart", {}).get("result", [])
                if result:
                    timestamps = result[0].get("timestamp", [])
                    quote = result[0].get("indicators", {}).get("quote", [{}])[0]
                    opens = quote.get("open", [])
                    highs = quote.get("high", [])
                    lows = quote.get("low", [])
                    closes = quote.get("close", [])
                    vols = quote.get("volume", [])
                    
                    for i in range(len(timestamps)):
                        cl = closes[i] if (closes and i < len(closes)) else None
                        op = opens[i] if (opens and i < len(opens)) else None
                        hi = highs[i] if (highs and i < len(highs)) else None
                        lo = lows[i] if (lows and i < len(lows)) else None
                        vo = vols[i] if (vols and i < len(vols)) else 0
                        
                        if cl is not None and op is not None and hi is not None and lo is not None:
                            d_str = datetime.datetime.fromtimestamp(timestamps[i]).strftime("%Y-%m-%d")
                            candles.append({
                                "time": d_str,
                                "open": round(op, 2),
                                "high": round(hi, 2),
                                "low": round(lo, 2),
                                "close": round(cl, 2),
                                "volume": round((vo or 0) / 1000.0, 1)
                            })
        except Exception as e:
            print(f"K線備用 API 擷取失敗 ({clean_sym}): {e}")

    # 4. 確保按日期由舊到新 (Ascending) 嚴格排序與去重
    seen_dates = set()
    unique_candles = []
    for c in sorted(candles, key=lambda x: str(x["time"])):
        if c.get("time") and c["time"] not in seen_dates:
            seen_dates.add(c["time"])
            unique_candles.append(c)

    res_data = {"status": "success", "symbol": clean_sym, "candles": unique_candles}
    KLINE_MEMORY_CACHE[clean_sym] = (now_ts, res_data)
    return res_data

class StockServerHandler(BaseHTTPRequestHandler):
    """用於支援網頁直接線上點擊更新與提供靜態資源的輕量級伺服器"""
    def log_message(self, format, *args):
        return

    def do_GET(self):
        clean_path = self.path.split('?')[0]
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        if clean_path in ["/", "/index.html"]:
            self.send_response(200)
            self.send_header("Content-type", "text/html; charset=utf-8")
            self.end_headers()
            try:
                with open(REPORT_FILE, "rb") as f:
                    self.wfile.write(f.read())
            except FileNotFoundError:
                self.wfile.write("<h3>正在生成初始報告中，請稍後並重新整理網頁...</h3>".encode('utf-8'))
        elif clean_path.startswith("/static/"):
            relative_path = clean_path.lstrip("/")
            file_path = os.path.join(base_dir, "web", relative_path)
            if os.path.exists(file_path):
                self.send_response(200)
                if file_path.endswith(".css"):
                    self.send_header("Content-type", "text/css; charset=utf-8")
                elif file_path.endswith(".js"):
                    self.send_header("Content-type", "application/javascript; charset=utf-8")
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, "File Not Found")
        elif clean_path == "/api/kline":
            import urllib.parse
            query_components = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            symbol = query_components.get("symbol", ["2330"])[0]
            
            self.send_response(200)
            self.send_header("Content-type", "application/json; charset=utf-8")
            self.end_headers()
            
            kline_res = fetch_kline_api(symbol)
            self.wfile.write(json.dumps(kline_res, ensure_ascii=False).encode('utf-8'))
        elif clean_path == "/api/refresh":
            self.send_response(200)
            self.send_header("Content-type", "application/json; charset=utf-8")
            self.end_headers()
            try:
                print("\n[網頁請求] 開始進行線上即時資料更新...")
                stocks = fetch_taiwan_stock_list()
                results = screen_stocks_bulk_parallel(stocks)
                print_console_report(results)
                generate_html_report(results)
                print("[網頁請求] 線上資料更新成功！")
                self.wfile.write(json.dumps({"status": "success", "message": "更新成功"}).encode('utf-8'))
            except Exception as e:
                print(f"[網頁請求] 線上更新失敗: {e}")
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
        else:
            self.send_error(404, "File Not Found")

def start_local_server(port=8000):
    """啟動本機伺服器並自動開啟網頁"""
    httpd = None
    actual_port = port
    for p in range(port, port + 10):
        try:
            httpd = HTTPServer(('', p), StockServerHandler)
            actual_port = p
            break
        except OSError:
            continue
            
    if httpd is None:
        print(f"❌ 無法啟動伺服器，連接埠 {port} 至 {port+9} 皆已被佔用。")
        return

    print("\n" + "#"*70)
    print(f" 🚀 本機伺服器已成功啟動於: http://localhost:{actual_port}")
    print(f" 🔗 現在您可以在瀏覽器中直接點擊「線上更新資料」按鈕重新整理！")
    print(f" 🛑 欲關閉伺服器，請在終端機按下 Ctrl + C 鍵。")
    print("#"*70 + "\n")
    
    webbrowser.open(f"http://localhost:{actual_port}")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n正在關閉本機伺服器...")
        httpd.server_close()

def main():
    run_as_server = "--server" in sys.argv or len(sys.argv) == 1
    results_cache_file = "last_results.json"
    
    results = []
    if os.path.exists(results_cache_file):
        try:
            with open(results_cache_file, "r", encoding="utf-8") as f:
                results = json.load(f)
        except Exception:
            pass
            
    if not results or "--fresh" in sys.argv:
        if os.path.exists(CACHE_FILE):
            try:
                os.remove(CACHE_FILE)
            except Exception:
                pass
        stocks = fetch_taiwan_stock_list()
        results = screen_stocks_bulk_parallel(stocks)
        print_console_report(results)
        
    generate_html_report(results)
        
    if run_as_server:
        start_local_server(8000)

if __name__ == "__main__":
    main()
