"""
screener/wave_analyzer.py - 艾略特波浪型態識別與買賣訊號評分模組
"""

from screener.indicators import find_peaks_and_valleys


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
        recommendation = "強勢多頭"
        badge_class = "badge-bullish"
    elif 0.5 <= score < 2.0:
        recommendation = "偏多走高"
        badge_class = "badge-bullish-mild"
    elif -0.5 < score < 0.5:
        recommendation = "震盪盤整"
        badge_class = "badge-sideways"
    elif -2.0 < score <= -0.5:
        recommendation = "偏空回測"
        badge_class = "badge-bearish-mild"
    else:
        recommendation = "強勢空頭"
        badge_class = "badge-bearish"
        
    return recommendation, score, signals, badge_class
