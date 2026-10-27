"""An Indian news vendor for TradingAgents' news analyst.

Yahoo tags few Indian listings, so upstream's news tools mostly come back empty
for .NS/.BO. This vendor, `orbis_india`, sits first in the news chain:

- company news: NewsData.io (the source Orbis's portfolio news already uses;
  optional, with NEWSDATA_API_KEY) and public Indian market RSS feeds,
  filtered to headlines naming the company;
- market news: the same feeds' economy and markets sections.

Look-ahead safe like upstream: only articles dated inside the requested window
are given to the analyst. When nothing is found, or every source is down, it
raises VendorUnavailableError and the router tries Yahoo next; if that has
nothing either, the analyst is told the data is unavailable. Nothing here ends
a run.
"""

from __future__ import annotations

import html
import json
import os
import re
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode
from xml.etree import ElementTree

try:  # Upstream's taxonomy, so the router reacts to these as to its own vendors'.
    from tradingagents.dataflows.errors import VendorUnavailableError
except ImportError:  # The tests run without TradingAgents installed.
    class VendorUnavailableError(Exception):
        """A vendor could not answer; the router tries the next one."""

from research_desk.tickers import bare_symbol

IST = timezone(timedelta(hours=5, minutes=30))
NEWSDATA_URL = "https://newsdata.io/api/1/latest"
MAX_BYTES = 2_000_000
TIMEOUT = 10

# Public RSS feeds of Indian business desks. Company news reads the markets and
# companies sections; market news reads markets and the economy.
COMPANY_FEEDS = {
    "Moneycontrol": "https://www.moneycontrol.com/rss/business.xml",
    "ET Markets": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "Mint": "https://www.livemint.com/rss/markets",
}
MARKET_FEEDS = {
    "Moneycontrol": "https://www.moneycontrol.com/rss/marketreports.xml",
    "ET Economy": "https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms",
    "Mint": "https://www.livemint.com/rss/markets",
}

_SUFFIX = re.compile(r"\s+(limited|ltd\.?|inc\.?|corp\.?|corporation|co\.?)$", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]{0,500}>")

_company_names: dict[str, str] = {}


@dataclass
class Article:
    title: str
    link: str
    summary: str
    source: str
    published: datetime | None


def set_company_name(ticker: str, name: str | None) -> None:
    """The company's name for `ticker`, resolved once per run from Yahoo's profile."""
    if name:
        _company_names[ticker] = name


def _clean(text, limit: int = 400) -> str:
    if not isinstance(text, str):
        return ""
    plain = _TAGS.sub(" ", html.unescape(text))
    return re.sub(r"\s+", " ", plain).strip()[:limit]


def search_terms(ticker: str, name: str | None) -> list[str]:
    """What a headline must mention: the name without its legal suffix, and the symbol when it's a word."""
    terms: list[str] = []
    if name:
        short = _SUFFIX.sub("", name.strip()).strip()
        if short:
            terms.append(short)
    symbol = bare_symbol(ticker)
    if symbol.isalpha() and len(symbol) >= 3 and symbol.lower() not in {t.lower() for t in terms}:
        terms.append(symbol)
    return terms


def _mentions(article: Article, terms: list[str]) -> bool:
    text = f"{article.title} {article.summary}"
    return any(re.search(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", text, re.IGNORECASE) for term in terms)


# ─── Parsing ────────────────────────────────────────────────────────────────

def parse_newsdata(payload) -> list[Article]:
    """NewsData's /latest reply. An error reply, or an item without a title or link, gives nothing."""
    if not isinstance(payload, dict) or payload.get("status") != "success" or not isinstance(payload.get("results"), list):
        return []
    articles = []
    for item in payload["results"]:
        if not isinstance(item, dict):
            continue
        title, link = _clean(item.get("title"), 300), item.get("link")
        if not title or not isinstance(link, str) or not link.startswith(("https://", "http://")):
            continue
        published = None
        if isinstance(item.get("pubDate"), str):
            try:  # NewsData dates are UTC.
                published = datetime.strptime(item["pubDate"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
            except ValueError:
                published = None
        source = _clean(item.get("source_name") or item.get("source_id") or "NewsData", 80)
        articles.append(Article(title, link, _clean(item.get("description")), source, published))
    return articles


def parse_rss(raw: bytes, source: str) -> list[Article]:
    """An RSS 2.0 feed's items. An HTML error page, an empty body or broken XML gives nothing."""
    if not raw:
        return []
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        return []
    articles = []
    for item in root.iter("item"):
        title = _clean(item.findtext("title"), 300)
        link = (item.findtext("link") or "").strip()
        if not title or not link.startswith(("https://", "http://")):
            continue
        published = None
        date = item.findtext("pubDate")
        if date:
            try:
                published = parsedate_to_datetime(date)
                if published.tzinfo is None:
                    published = published.replace(tzinfo=UTC)
            except (TypeError, ValueError):
                published = None
        articles.append(Article(title, link, _clean(item.findtext("description")), source, published))
    return articles


# ─── Fetching ───────────────────────────────────────────────────────────────

def fetch_url(url: str, timeout: float = TIMEOUT) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; OrbisResearchDesk/1.0)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(MAX_BYTES)


def _window(start_date: str, end_date: str) -> tuple[datetime, datetime]:
    start = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=IST)
    end = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=IST) + timedelta(days=1)
    return start, end


def _inside(article: Article, start: datetime, end: datetime) -> bool:
    # Undated items can't be placed in time, so they could be from the future of a past date: left out.
    return article.published is not None and start <= article.published < end


def _gather(feeds: dict[str, str], fetch, newsdata_query: dict | None) -> tuple[list[Article], int]:
    """Every source's articles, and how many sources answered at all."""
    found: list[Article] = []
    answered = 0
    key = os.environ.get("NEWSDATA_API_KEY", "").strip()
    if key and newsdata_query is not None:
        url = f"{NEWSDATA_URL}?{urlencode({'apikey': key, 'country': 'in', 'language': 'en', **newsdata_query})}"
        try:
            found += parse_newsdata(json.loads(fetch(url, timeout=TIMEOUT)))
            answered += 1
        except Exception:  # noqa: BLE001 — one source down is not a failed run
            pass
    for source, url in feeds.items():
        try:
            items = parse_rss(fetch(url, timeout=TIMEOUT), source)
        except Exception:  # noqa: BLE001
            continue
        answered += 1
        found += items
    return found, answered


def _dedupe(articles: list[Article]) -> list[Article]:
    seen, unique = set(), []
    for article in sorted(articles, key=lambda a: a.published or datetime.min.replace(tzinfo=UTC), reverse=True):
        key = re.sub(r"\W+", " ", article.title.lower()).strip()
        if key not in seen:
            seen.add(key)
            unique.append(article)
    return unique


def _format(articles: list[Article]) -> str:
    out = ""
    for article in articles:
        when = article.published.astimezone(IST).strftime("%Y-%m-%d") if article.published else ""
        out += f"### {article.title} (source: {article.source}{', ' + when if when else ''})\n"
        if article.summary:
            out += f"{article.summary}\n"
        out += f"Link: {article.link}\n\n"
    return out


# ─── The vendor's two methods ───────────────────────────────────────────────

def get_news_india(ticker: str, start_date: str, end_date: str, *, fetch=fetch_url, limit: int = 20) -> str:
    """Headlines naming the company inside the window, newest first."""
    terms = search_terms(ticker, _company_names.get(ticker))
    if not terms:
        raise VendorUnavailableError(f"No company name known for {ticker}")
    found, answered = _gather(COMPANY_FEEDS, fetch, {"q": terms[0][:100], "category": "business"})
    if not answered:
        raise VendorUnavailableError("No Indian news source answered")
    start, end = _window(start_date, end_date)
    matched = _dedupe([a for a in found if _inside(a, start, end) and _mentions(a, terms)])[:limit]
    if not matched:
        raise VendorUnavailableError(f"No Indian headlines name {ticker} in the window")
    return f"## {ticker} News (Indian sources), from {start_date} to {end_date}:\n\n{_format(matched)}"


def get_global_news_india(as_of_date: str, look_back_days: int | None = None, limit: int | None = None, *, fetch=fetch_url) -> str:
    """Indian market and economy headlines for the week before `as_of_date`."""
    days = 7 if look_back_days is None else int(look_back_days)
    count = 10 if limit is None else int(limit)
    end_day = datetime.strptime(as_of_date, "%Y-%m-%d")
    start_date = (end_day - timedelta(days=days)).strftime("%Y-%m-%d")
    found, _ = _gather(MARKET_FEEDS, fetch, {"category": "business"})
    start, end = _window(start_date, as_of_date)
    in_window = _dedupe([a for a in found if _inside(a, start, end)])[:count]
    if not in_window:
        return (f"No Indian market headlines could be read for {start_date} to {as_of_date}. "
                "This is not an absence of news; treat market news as unavailable.")
    return f"## Indian market news, from {start_date} to {as_of_date}:\n\n{_format(in_window)}"


def register() -> None:
    """Adds `orbis_india` to TradingAgents' router, for config's news_data chain."""
    from tradingagents.dataflows import router

    router.VENDOR_METHODS["get_news"]["orbis_india"] = get_news_india
    router.VENDOR_METHODS["get_global_news"]["orbis_india"] = get_global_news_india
