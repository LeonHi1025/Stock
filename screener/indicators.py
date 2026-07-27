"""
screener/indicators.py - 技術指標計算模組
包含 EMA, MACD, RSI, KD, Bollinger Bands 等指標計算 logic
"""

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
