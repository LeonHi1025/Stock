"""
screener/report_builder.py - 網頁報告打包與大盤指數資訊抓取模組
"""

import os
import json
import datetime
import requests
from screener.data_fetcher import session

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT_FILE = os.path.join(BASE_DIR, "stock_report.html")
RESULTS_CACHE_FILE = os.path.join(BASE_DIR, "last_results.json")


def fetch_market_data():
    """抓取加權指數 (TAIEX) 與台指期 (TXF) 盤中行情"""
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
    tz_tw = datetime.timezone(datetime.timedelta(hours=8))
    now_str = datetime.datetime.now(tz_tw).strftime('%Y-%m-%d %H:%M:%S')
    
    if results:
        try:
            with open(RESULTS_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
            
    market_info = fetch_market_data()
    market_json = json.dumps(market_info, ensure_ascii=False)
    results_json = json.dumps(results, ensure_ascii=False)
    
    template_dir = os.path.join(BASE_DIR, "web", "templates")
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
            
        html_content = html_content.replace("__NOW_STR__", now_str) \
                                   .replace("__MARKET_JSON__", market_json) \
                                   .replace("__RESULTS_JSON__", results_json) \
                                   .replace("__DAILY_REVIEW_CONTENT__", daily_content) \
                                   .replace("__REALTIME_ANALYSIS_CONTENT__", realtime_content)
        
        with open(REPORT_FILE, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"\n互動式網頁報告已成功產出: {REPORT_FILE}")
