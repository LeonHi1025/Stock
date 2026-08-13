"""
screener/news_fetcher.py - 個股全網新聞抓取與多因子情緒分析模組
支援媒體：理財周刊、時報新聞、三立新聞台、FTNN新聞網、鉅亨網、經濟日報、工商時報、MoneyDJ、自由財經、Yahoo股市、CMoney等
"""

import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import re
import datetime
import email.utils

# 台股專用利多與利空關鍵字字典 (全網市場新聞情緒字典)
BULLISH_KEYWORDS = [
    "營收創新高", "創高", "大增", "獲利", "買超", "漲停", "利多", "突破", "飆漲",
    "上修", "擴產", "轉盈", "爆量", "訂單滿載", "看好", "旺季", "強勢", "大賺",
    "成長", "新高", "超越", "攀升", "優於預期", "配息", "急單", "卡位", "毛利率拉升",
    "三率三升", "法說會利多", "營收亮眼", "外資回流", "買盤強勁", "擴大資本支出",
    "業績亮麗", "迎轉機", "單月新高", "獲利看俏", "填息", "重回成長", "展望樂觀",
    "利多解讀", "強勢主導", "買盤追捧", "飆高", "營運加溫", "受惠", "亮眼"
]

BEARISH_KEYWORDS = [
    "虧損", "賣超", "下修", "衰退", "利空", "跌停", "警訊", "裁員", "暴跌",
    "賣壓", "違約", "觀望", "匯損", "減少", "下挫", "悲觀", "低於預期",
    "重挫", "減資", "提列", "停工", "破底", "面臨挑戰", "目標價下修", "庫存調整",
    "投信調節", "營收降溫", "展望保守", "利空洗盤", "轉盈為虧", "終止連增",
    "成本上揚", "利潤侵蝕", "停利賣壓", "出貨放緩", "需求疲軟", "倒貨", "震盪回檔"
]

# 全網媒體來源比對標籤
SOURCE_PATTERNS = [
    ("理財周刊", "理財周刊"),
    ("moneyweekly", "理財周刊"),
    ("時報新聞", "時報新聞"),
    ("中時", "時報新聞"),
    ("chinatimes", "時報新聞"),
    ("工商時報", "工商時報"),
    ("ctee", "工商時報"),
    ("三立新聞", "三立新聞台"),
    ("三立", "三立新聞台"),
    ("setn", "三立新聞台"),
    ("ftnn", "FTNN新聞網"),
    ("鉅亨", "鉅亨網"),
    ("cnyes", "鉅亨網"),
    ("經濟日報", "經濟日報"),
    "大跌", "崩盤", "創新低", "利空", "減產", "衰退", "賣超", "弱勢", 
    "跌停", "虧損", "保守", "低於預期", "警訊", "下修", "裁員", "拖累",
    "重挫", "賣壓", "貼息", "破底", "空頭", "悲觀", "觀望", "修正", "面臨考驗",
    "衝擊", "急凍", "寒冬", "大砍", "砍單", "認列虧損", "提列"
]

def clean_source_name(raw_source, link):
    """
    精準比對媒體來源
    """
    if raw_source:
        s = raw_source.strip()
        if "理財" in s or "Money" in s: return "理財周刊"
        if "工商" in s or "中時" in s or "時報" in s: return "時報新聞"
        if "三立" in s: return "三立新聞台"
        if "FTNN" in s or "FTN" in s: return "FTNN新聞網"
        if "鉅亨" in s: return "鉅亨網"
        if "經濟" in s: return "經濟日報"
        if "MoneyDJ" in s or "理財網" in s: return "MoneyDJ理財網"
        if "自由" in s or "LTN" in s: return "自由財經"
        if "今周" in s: return "今周刊"
        if "Yahoo" in s or "雅虎" in s: return "Yahoo 股市"
        if "CMoney" in s: return "CMoney理財寶"
        if "東森" in s or "EBC" in s: return "EBC東森財經"
        if "TVBS" in s: return "TVBS新聞"
        if "風傳媒" in s: return "風傳媒財經"
        return s

    if "ctee.com.tw" in link or "chinatimes.com" in link: return "時報新聞"
    if "money.udn.com" in link or "udn.com" in link: return "經濟日報"
    if "cnyes.com" in link: return "鉅亨網"
    if "moneydj.com" in link: return "MoneyDJ理財網"
    if "ec.ltn.com.tw" in link: return "自由財經"
    if "businesstoday.com.tw" in link: return "今周刊"
    if "moneyweekly.com.tw" in link: return "理財周刊"
    if "ftnn.com.tw" in link: return "FTNN新聞網"
    if "setn.com" in link: return "三立新聞台"
    if "yahoo.com" in link: return "Yahoo 股市"
    if "cmoney.tw" in link: return "CMoney理財寶"
    return "市場財經新聞"

def parse_pub_datetime(pub_date_str):
    """
    解析 RFC 822 / RFC 2822 標準 RSS 發布時間，回傳 (formatted_date_str, timestamp)
    """
    if pub_date_str:
        try:
            dt = email.utils.parsedate_to_datetime(pub_date_str.strip())
            if dt:
                # 轉為在地台北時間 (UTC+8)
                tz_offset = datetime.timezone(datetime.timedelta(hours=8))
                local_dt = dt.astimezone(tz_offset)
                return local_dt.strftime("%Y-%m-%d %H:%M"), local_dt.timestamp()
        except Exception:
            pass
        
        # 正則相容一般日期格式 YYYY-MM-DD
        match = re.search(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', str(pub_date_str))
        if match:
            y, m, d = match.group(1), match.group(2).zfill(2), match.group(3).zfill(2)
            d_str = f"{y}-{m}-{d} 08:00"
            try:
                dt = datetime.datetime.strptime(d_str, "%Y-%m-%d %H:%M")
                return d_str, dt.timestamp()
            except Exception:
                pass
                
    return "", 0

def fetch_stock_news(symbol, stock_name="", max_count=10):
    """
    全網財經新聞聚合器：抓取最多 10 則最新個股報導，嚴格依真實發布時間「最新到最舊」排序
    """
    clean_code = symbol.split('.')[0]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
    
    news_items = []
    seen_titles = set()

    # 1. 優先抓取 Yahoo 股市個股專屬即時新聞 RSS (包含真實發布時間)
    yahoo_rss_url = f"https://tw.stock.yahoo.com/rss?s={clean_code}"
    try:
        req_y = urllib.request.Request(yahoo_rss_url, headers=headers)
        with urllib.request.urlopen(req_y, timeout=5) as resp_y:
            xml_data_y = resp_y.read()
            root_y = ET.fromstring(xml_data_y)
            for item in root_y.findall('.//item'):
                title = item.findtext('title') or ""
                link = item.findtext('link') or f"https://tw.stock.yahoo.com/quote/{clean_code}"
                pub_date = item.findtext('pubDate') or ""
                
                clean_title = re.sub(r'\s*-\s*[^-]+$', '', title).strip()
                simplified_title = re.sub(r'[^\w]', '', clean_title)
                if not clean_title or len(clean_title) < 5 or simplified_title in seen_titles:
                    continue
                seen_titles.add(simplified_title)
                
                date_str, pub_ts = parse_pub_datetime(pub_date)
                if not pub_ts:
                    continue
                
                bull_cnt = sum(1 for kw in BULLISH_KEYWORDS if kw in title)
                bear_cnt = sum(1 for kw in BEARISH_KEYWORDS if kw in title)
                if bull_cnt > bear_cnt:
                    sentiment_tag = "利多"
                    sentiment_class = "bullish"
                elif bear_cnt > bull_cnt:
                    sentiment_tag = "利空"
                    sentiment_class = "bearish"
                else:
                    sentiment_tag = "中性"
                    sentiment_class = "neutral"
                    
                news_items.append({
                    "title": clean_title,
                    "link": link,
                    "date": date_str,
                    "pub_ts": pub_ts,
                    "source": "Yahoo 股市",
                    "sentiment_tag": sentiment_tag,
                    "sentiment_class": sentiment_class
                })
    except Exception:
        pass

    # 2. 補充抓取全網 Google News RSS (精準查詢個股名稱與代號，限制近 7 天最新報導)
    q_target = f'"{stock_name}" when:7d' if stock_name else f'{clean_code} when:7d'
    queries = [
        q_target,
        f'"{clean_code}" when:7d'
    ]

    for q_str in queries:
        encoded = urllib.parse.quote(q_str)
        rss_url = f"https://news.google.com/rss/search?q={encoded}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
        
        try:
            req = urllib.request.Request(rss_url, headers=headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                xml_data = resp.read()
                root = ET.fromstring(xml_data)
                
                for item in root.findall('.//item'):
                    title = item.findtext('title') or ""
                    link = item.findtext('link') or "#"
                    pub_date = item.findtext('pubDate') or ""
                    
                    clean_title = re.sub(r'\s*-\s*[^-]+$', '', title).strip()
                    
                    # 🔑 嚴格過濾：標題必須含有該股名稱或股票代碼！避免模糊比對導致混淆（如「群創」抓到「群聯」）
                    if stock_name and stock_name not in clean_title and clean_code not in clean_title:
                        continue
                    if stock_name == "群創" and "群聯" in clean_title and "群創" not in clean_title:
                        continue
                        
                    source_match = re.search(r'\s*-\s*([^-]+)$', title)
                    raw_source = source_match.group(1).strip() if source_match else ""
                    source = clean_source_name(raw_source, link)
                    
                    simplified_title = re.sub(r'[^\w]', '', clean_title)
                    if not clean_title or len(clean_title) < 5 or simplified_title in seen_titles:
                        continue
                    seen_titles.add(simplified_title)
                    
                    date_str, pub_ts = parse_pub_datetime(pub_date)
                    if not pub_ts:
                        continue
                    
                    bull_cnt = sum(1 for kw in BULLISH_KEYWORDS if kw in title)
                    bear_cnt = sum(1 for kw in BEARISH_KEYWORDS if kw in title)
                    
                    if bull_cnt > bear_cnt:
                        sentiment_tag = "強烈利多" if bull_cnt >= 2 else "利多"
                        sentiment_class = "bullish"
                    elif bear_cnt > bull_cnt:
                        sentiment_tag = "強烈利空" if bear_cnt >= 2 else "利空"
                        sentiment_class = "bearish"
                    else:
                        sentiment_tag = "中性"
                        sentiment_class = "neutral"
                    
                    news_items.append({
                        "title": clean_title,
                        "link": link,
                        "date": date_str,
                        "pub_ts": pub_ts,
                        "source": source,
                        "sentiment_tag": sentiment_tag,
                        "sentiment_class": sentiment_class
                    })
        except Exception:
            pass

    # 🔑 依真實發布時間戳記 (pub_ts) 由最新到最舊降序排序
    news_items.sort(key=lambda x: x.get("pub_ts", 0), reverse=True)

    # 確保回傳最多 10 則新聞
    news_items = news_items[:max_count]

    # 計算全網綜合新聞情緒指標 (0 ~ 100 分)
    total_bull = sum(1 for n in news_items if n["sentiment_class"] == "bullish")
    total_bear = sum(1 for n in news_items if n["sentiment_class"] == "bearish")
    total_news = len(news_items) or 1
    
    bull_ratio = total_bull / total_news
    bear_ratio = total_bear / total_news
    base_score = 50 + int((bull_ratio - bear_ratio) * 40)
    sentiment_score = max(15, min(95, base_score))
    
    if sentiment_score >= 65:
        status = "🔥 樂觀偏多"
        summary = f"全網最新 {total_news} 則報導中包含 {total_bull} 則利多訊息，法人與新聞聲量偏向正面。"
        badge_class = "bullish"
    elif sentiment_score <= 40:
        status = "❄️ 悲觀偏空"
        summary = f"全網最新 {total_news} 則報導中包含 {total_bear} 則利空警訊，市場情緒保守觀望。"
        badge_class = "bearish"
    else:
        status = "⚖️ 中性觀望"
        summary = f"全網最新 {total_news} 則報導顯示訊息多空交錯 (利多 {total_bull} 則 / 利空 {total_bear} 則)，籌碼處於整理階段。"
        badge_class = "neutral"
        
    return {
        "sentiment_score": sentiment_score,
        "status": status,
        "summary": summary,
        "badge_class": badge_class,
        "bullish_count": total_bull,
        "bearish_count": total_bear,
        "neutral_count": total_news - total_bull - total_bear,
        "news": news_items
    }

