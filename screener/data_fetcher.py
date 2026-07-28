"""
screener/data_fetcher.py - 數據下載與 TWSE / TPEx 官方 API 對接模組
"""

import os
import sys
import json
import time
import datetime
import urllib.request
import re
from io import StringIO
import requests
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_FILE = os.path.join(BASE_DIR, "taiwan_stocks_cache.json")
TWSE_CACHE_FILE = os.path.join(BASE_DIR, "twse_daily_cache.json")

session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
})

GLOBAL_TWSE_DATASETS = None


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


def fetch_single_finmind_inst(symbol_clean):
    """當 TWSE/TPEx 官方 API 在 GitHub Actions 上遭封鎖或資料缺漏時，無縫調用 FinMind 免費行情 API 補齊三大法人真實買賣超張數"""
    try:
        start_date = (datetime.date.today() - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
        url = f"https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id={symbol_clean}&start_date={start_date}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            rows = data.get("data", [])
            if not rows:
                return None
            latest_date = rows[-1]["date"]
            day_rows = [r for r in rows if r.get("date") == latest_date]

            foreign = 0
            trust = 0
            dealer = 0
            for r in day_rows:
                name = r.get("name", "")
                net_shares = r.get("buy", 0) - r.get("sell", 0)
                net_lots = round(net_shares / 1000)
                if "Foreign" in name:
                    foreign += net_lots
                elif "Trust" in name:
                    trust += net_lots
                elif "Dealer" in name:
                    dealer += net_lots

            return {
                "foreign": foreign,
                "trust": trust,
                "dealer": dealer,
                "total": foreign + trust + dealer
            }
    except Exception:
        return None


def fetch_twse_official_datasets():
    """
    從台灣證券交易所 (TWSE) 及櫃買中心 (TPEx) 官方 API 批量載入三大法人買賣超、信用交易 (融資融券) 及個股估值數據。
    採用「全市場單次批量抓取 + 本地持久化快取 (twse_daily_cache.json)」防封鎖機制。
    """
    global GLOBAL_TWSE_DATASETS
    if GLOBAL_TWSE_DATASETS is not None:
        return GLOBAL_TWSE_DATASETS

    today_str = datetime.datetime.now().strftime("%Y%m%d")
    
    # 讀取本地快取
    if os.path.exists(TWSE_CACHE_FILE):
        try:
            with open(TWSE_CACHE_FILE, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                if len(cached_data.get("inst", {})) > 0:
                    if cached_data.get("cache_date") == today_str or not "--fresh" in sys.argv:
                        print(f"⚡ 成功讀取 TWSE/TPEx 證交所與櫃買中心官方數據快取 (共 {len(cached_data.get('inst',{}))} 檔)")
                        GLOBAL_TWSE_DATASETS = cached_data
                        return GLOBAL_TWSE_DATASETS
        except Exception as e:
            print(f"⚠️ 讀取 TWSE/TPEx 快取失敗: {e}")

    print("🌐 正向 TWSE/TPEx 證交所與櫃買中心官方 API 批量抓取三大法人與資券估值數據 (防封鎖單次請求)...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    inst_dict = {}    # symbol -> {foreign, trust, dealer, total}
    margin_dict = {}  # symbol -> {margin_buy, short_sell}
    val_dict = {}     # symbol -> {pe, pb, yield_pct}

    # 1. 抓取 TWSE T86 三大法人買賣超日報
    try:
        url_t86 = "https://www.twse.com.tw/rwd/zh/fund/T86?response=json&selectType=ALL"
        req = urllib.request.Request(url_t86, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("stat") == "OK" and "data" in data:
                for row in data["data"]:
                    symbol = str(row[0]).strip()
                    try:
                        foreign_shares = int(str(row[4]).replace(",", ""))
                        trust_shares = int(str(row[10]).replace(",", ""))
                        dealer_shares = int(str(row[11]).replace(",", ""))
                        total_shares = int(str(row[18]).replace(",", ""))
                        inst_dict[symbol] = {
                            "foreign": round(foreign_shares / 1000),
                            "trust": round(trust_shares / 1000),
                            "dealer": round(dealer_shares / 1000),
                            "total": round(total_shares / 1000)
                        }
                    except (ValueError, IndexError):
                        continue
                print(f"✅ 成功載入 TWSE 三大法人買賣超數據 (共 {len(inst_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TWSE T86 抓取失敗: {e}")

    time.sleep(1.2)

    # 2. 抓取 TWSE MI_MARGN 信用交易 (融資融券) 日報
    try:
        url_margin = "https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&selectType=ALL"
        req = urllib.request.Request(url_margin, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("stat") == "OK" and "tables" in data and len(data["tables"]) > 1:
                table1 = data["tables"][1]
                for row in table1.get("data", []):
                    symbol = str(row[0]).strip()
                    try:
                        margin_bal = int(str(row[6]).replace(",", "")) if row[6] and row[6] != "--" else 0
                        short_bal = int(str(row[12]).replace(",", "")) if row[12] and row[12] != "--" else 0
                        margin_dict[symbol] = {
                            "margin_buy": margin_bal,
                            "short_sell": short_bal
                        }
                    except (ValueError, IndexError):
                        continue
                print(f"✅ 成功載入 TWSE 融資融券籌碼數據 (共 {len(margin_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TWSE MI_MARGN 抓取失敗: {e}")

    time.sleep(1.2)

    # 3. 抓取 TWSE BWIBBU_ALL 本益比、殖利率與淨值比
    try:
        url_bw = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"
        req = urllib.request.Request(url_bw, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list):
                for row in data:
                    symbol = str(row.get("Code", "")).strip()
                    pe = float(row.get("PEratio")) if row.get("PEratio") and row.get("PEratio") != "-" else 0.0
                    pb = float(row.get("PBratio")) if row.get("PBratio") and row.get("PBratio") != "-" else 0.0
                    yield_pct = float(row.get("DividendYield")) if row.get("DividendYield") and row.get("DividendYield") != "-" else 0.0
                    val_dict[symbol] = {
                        "pe": round(pe, 1) if pe else 15.0,
                        "pb": round(pb, 2) if pb else 1.2,
                        "yield_pct": round(yield_pct, 2) if yield_pct else 3.5
                    }
                print(f"✅ 成功載入 TWSE 本益比與殖利率數據 (共 {len(val_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TWSE BWIBBU 抓取失敗: {e}")

    time.sleep(1.2)

    # 4. 抓取 TWSE STOCK_DAY_ALL 官方全市場當日成交價格與金額
    day_dict = {}
    try:
        url_day = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
        req = urllib.request.Request(url_day, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list):
                for row in data:
                    symbol = str(row.get("Code", "")).strip()
                    try:
                        open_p = float(row.get("OpeningPrice", 0)) if row.get("OpeningPrice") else 0.0
                        high_p = float(row.get("HighestPrice", 0)) if row.get("HighestPrice") else 0.0
                        low_p = float(row.get("LowestPrice", 0)) if row.get("LowestPrice") else 0.0
                        close_p = float(row.get("ClosingPrice", 0)) if row.get("ClosingPrice") else 0.0
                        change_p = float(row.get("Change", 0)) if row.get("Change") else 0.0
                        trade_val = float(row.get("TradeValue", 0)) / 1000000.0 if row.get("TradeValue") else 0.0
                        day_dict[symbol] = {
                            "open": open_p,
                            "high": high_p,
                            "low": low_p,
                            "close": close_p,
                            "change": change_p,
                            "amount_millions": round(trade_val, 1)
                        }
                    except (ValueError, TypeError):
                        continue
                print(f"✅ 成功載入 TWSE 官方每日個股成交金額數據 (共 {len(day_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TWSE STOCK_DAY_ALL 抓取失敗: {e}")

    time.sleep(1.2)

    # 5. 抓取 TPEx 櫃買中心上櫃股票三大法人買賣超
    try:
        url_tpex_inst = "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&response=json"
        req = urllib.request.Request(url_tpex_inst, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tables = data.get("tables", [])
            if tables:
                data0 = tables[0].get("data", [])
                for row in data0:
                    symbol = str(row[0]).strip()
                    try:
                        foreign_shares = int(str(row[4]).replace(",", ""))
                        trust_shares = int(str(row[10]).replace(",", ""))
                        dealer_shares = int(str(row[16]).replace(",", ""))
                        total_shares = int(str(row[23]).replace(",", ""))
                        inst_dict[symbol] = {
                            "foreign": round(foreign_shares / 1000),
                            "trust": round(trust_shares / 1000),
                            "dealer": round(dealer_shares / 1000),
                            "total": round(total_shares / 1000)
                        }
                    except (ValueError, IndexError):
                        continue
                print(f"✅ 成功載入 TPEx 櫃買三大法人買賣超數據 (目前合計 {len(inst_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TPEx 三大法人抓取失敗: {e}")

    time.sleep(1.2)

    # 6. 抓取 TPEx 櫃買中心上櫃股票信用交易 (融資融券)
    try:
        url_tpex_margin = "https://www.tpex.org.tw/www/zh-tw/margin/balance?type=Daily&response=json"
        req = urllib.request.Request(url_tpex_margin, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tables = data.get("tables", [])
            if tables:
                data0 = tables[0].get("data", [])
                for row in data0:
                    symbol = str(row[0]).strip()
                    try:
                        margin_bal = int(str(row[6]).replace(",", "")) if row[6] and row[6] != "--" else 0
                        short_bal = int(str(row[14]).replace(",", "")) if row[14] and row[14] != "--" else 0
                        margin_dict[symbol] = {
                            "margin_buy": margin_bal,
                            "short_sell": short_bal
                        }
                    except (ValueError, IndexError):
                        continue
                print(f"✅ 成功載入 TPEx 櫃買融資融券數據 (目前合計 {len(margin_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TPEx 融資融券抓取失敗: {e}")

    time.sleep(1.2)

    # 7. 抓取 TPEx 櫃買中心上櫃股票個股估值 (P/E, P/B, 殖利率%)
    try:
        url_tpex_val = "https://www.tpex.org.tw/web/stock/aftertrading/peratio_analysis/pera_result.php?l=zh-tw&o=json"
        req = urllib.request.Request(url_tpex_val, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tables = data.get("tables", [])
            if tables:
                data0 = tables[0].get("data", [])
                for row in data0:
                    symbol = str(row[0]).strip()
                    try:
                        pe = float(row[2]) if row[2] and row[2] != "N/A" and row[2] != "-" else 0.0
                        yield_pct = float(row[3]) if row[3] and row[3] != "N/A" and row[3] != "-" else 0.0
                        pb = float(row[6]) if row[6] and row[6] != "N/A" and row[6] != "-" else 0.0
                        val_dict[symbol] = {
                            "pe": round(pe, 1) if pe else 15.0,
                            "pb": round(pb, 2) if pb else 1.2,
                            "yield_pct": round(yield_pct, 2) if yield_pct else 3.5
                        }
                    except (ValueError, IndexError):
                        continue
                print(f"✅ 成功載入 TPEx 櫃買本益比與殖利率數據 (目前合計 {len(val_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TPEx 估值數據抓取失敗: {e}")

    time.sleep(1.2)

    # 8. 抓取 TPEx 櫃買中心上櫃股票每日成交價格與金額
    try:
        url_tpex_day = "https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&response=json"
        req = urllib.request.Request(url_tpex_day, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tables = data.get("tables", [])
            if tables:
                data0 = tables[0].get("data", [])
                for row in data0:
                    symbol = str(row[0]).strip()
                    try:
                        close_p = float(str(row[2]).replace(",", "")) if row[2] and row[2] != "---" else 0.0
                        change_p = float(str(row[3]).replace(",", "").replace("+","")) if row[3] and row[3] != "---" else 0.0
                        open_p = float(str(row[4]).replace(",", "")) if row[4] and row[4] != "---" else close_p
                        high_p = float(str(row[5]).replace(",", "")) if row[5] and row[5] != "---" else close_p
                        low_p = float(str(row[6]).replace(",", "")) if row[6] and row[6] != "---" else close_p
                        trade_val = float(str(row[9]).replace(",", "")) / 1000000.0 if row[9] and row[9] != "---" else 0.0
                        day_dict[symbol] = {
                            "open": open_p,
                            "high": high_p,
                            "low": low_p,
                            "close": close_p,
                            "change": change_p,
                            "amount_millions": round(trade_val, 1)
                        }
                    except (ValueError, IndexError, TypeError):
                        continue
                print(f"✅ 成功載入 TPEx 櫃買每日成交價格數據 (目前合計 {len(day_dict)} 檔標的)")
    except Exception as e:
        print(f"⚠️ TPEx 每日成交價格抓取失敗: {e}")

    GLOBAL_TWSE_DATASETS = {
        "cache_date": today_str,
        "inst": inst_dict,
        "margin": margin_dict,
        "val": val_dict,
        "day": day_dict
    }

    try:
        with open(TWSE_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(GLOBAL_TWSE_DATASETS, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ 寫入 TWSE 快取失敗: {e}")

    return GLOBAL_TWSE_DATASETS
