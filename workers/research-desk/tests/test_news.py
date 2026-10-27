import json

import pytest

from research_desk import news

NEWSDATA = {
    "status": "success",
    "results": [
        {
            "article_id": "a1",
            "title": "Reliance Industries posts record quarterly profit",
            "link": "https://example.in/reliance-profit",
            "description": "Jio and retail <b>lift</b> margins.",
            "pubDate": "2026-10-26 09:15:00",
            "source_name": "Example Business",
        },
        {"article_id": "a2", "title": "No link here", "pubDate": "2026-10-26 09:15:00"},
        {
            "article_id": "a3",
            "title": "Old Reliance story",
            "link": "https://example.in/old",
            "pubDate": "2026-09-01 09:15:00",
            "source_id": "oldsource",
        },
    ],
}

RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Markets</title>
<item><title>Nifty ends higher as banks rally</title><link>https://example.in/nifty</link>
<description><![CDATA[<p>HDFC Bank and SBI led.</p>]]></description><pubDate>Mon, 26 Oct 2026 10:00:00 +0530</pubDate></item>
<item><title>Reliance shares slip after results</title><link>https://example.in/ril</link>
<description>Profit booking.</description><pubDate>Tue, 27 Oct 2026 08:00:00 +0530</pubDate></item>
<item><title>Undated item</title><link>https://example.in/undated</link></item>
</channel></rss>"""


def test_newsdata_items_without_a_link_are_dropped_and_html_is_stripped():
    articles = news.parse_newsdata(NEWSDATA)
    assert [a.title for a in articles] == ["Reliance Industries posts record quarterly profit", "Old Reliance story"]
    assert articles[0].summary == "Jio and retail lift margins."
    assert articles[0].source == "Example Business"
    assert articles[1].source == "oldsource"
    assert articles[0].published.isoformat().startswith("2026-10-26")


def test_newsdata_error_replies_read_as_no_articles():
    assert news.parse_newsdata({"status": "error", "results": {"message": "quota"}}) == []
    assert news.parse_newsdata(None) == []


def test_rss_parses_items_and_survives_an_html_error_page():
    articles = news.parse_rss(RSS, "ET Markets")
    assert [a.title for a in articles][:2] == ["Nifty ends higher as banks rally", "Reliance shares slip after results"]
    assert articles[0].summary == "HDFC Bank and SBI led."
    assert articles[2].published is None
    assert news.parse_rss(b"<html><body>502 Bad Gateway</body></html>", "x") == []
    assert news.parse_rss(b"", "x") == []
    assert news.parse_rss(b"not xml at all <<<", "x") == []


def fake_fetch(responses):
    def fetch(url, timeout=10):
        for needle, body in responses.items():
            if needle in url:
                if isinstance(body, Exception):
                    raise body
                return body
        raise OSError("unreachable")
    return fetch


def test_company_news_mixes_newsdata_and_rss_inside_the_window(monkeypatch):
    monkeypatch.setenv("NEWSDATA_API_KEY", "key")
    news.set_company_name("RELIANCE.NS", "Reliance Industries Limited")
    fetch = fake_fetch({"newsdata.io": json.dumps(NEWSDATA).encode(), "rss": RSS, "rssfeeds": RSS})
    text = news.get_news_india("RELIANCE.NS", "2026-10-20", "2026-10-27", fetch=fetch)
    assert text.startswith("## RELIANCE.NS News (Indian sources), from 2026-10-20 to 2026-10-27")
    assert "Reliance Industries posts record quarterly profit" in text
    assert "Reliance shares slip after results" in text
    # Outside the window, and not about the company.
    assert "Old Reliance story" not in text
    assert "Nifty ends higher" not in text
    # The same story from two feeds is listed once.
    assert text.count("Reliance shares slip after results") == 1


def test_company_news_with_nothing_found_hands_over_to_the_next_vendor(monkeypatch):
    monkeypatch.delenv("NEWSDATA_API_KEY", raising=False)
    fetch = fake_fetch({"rss": RSS, "rssfeeds": RSS})
    with pytest.raises(news.VendorUnavailableError):
        news.get_news_india("TCS.NS", "2026-10-20", "2026-10-27", fetch=fetch)
    # Every source down: the same, never an exception that ends the run.
    with pytest.raises(news.VendorUnavailableError):
        news.get_news_india("TCS.NS", "2026-10-20", "2026-10-27", fetch=fake_fetch({}))


def test_the_newsdata_key_never_appears_in_what_the_analyst_reads(monkeypatch):
    monkeypatch.setenv("NEWSDATA_API_KEY", "super-secret-key")
    news.set_company_name("RELIANCE.NS", "Reliance Industries")
    seen = []

    def fetch(url, timeout=10):
        seen.append(url)
        return json.dumps(NEWSDATA).encode() if "newsdata.io" in url else RSS

    text = news.get_news_india("RELIANCE.NS", "2026-10-20", "2026-10-27", fetch=fetch)
    assert "super-secret-key" not in text
    assert any("apikey=super-secret-key" in url and "country=in" in url for url in seen)


def test_global_news_is_indian_market_news_in_the_window(monkeypatch):
    monkeypatch.delenv("NEWSDATA_API_KEY", raising=False)
    text = news.get_global_news_india("2026-10-27", look_back_days=7, limit=5, fetch=fake_fetch({"rss": RSS, "rssfeeds": RSS}))
    assert "Nifty ends higher as banks rally" in text
    assert "Undated item" not in text
    empty = news.get_global_news_india("2026-10-27", look_back_days=7, limit=5, fetch=fake_fetch({}))
    assert empty.startswith("No Indian market headlines")


def test_search_terms_drop_the_legal_suffix():
    assert news.search_terms("RELIANCE.NS", "Reliance Industries Limited") == ["Reliance Industries", "RELIANCE"]
    assert news.search_terms("500325.BO", None) == []
    assert news.search_terms("HDFCBANK.NS", "HDFC Bank Ltd.") == ["HDFC Bank", "HDFCBANK"]
