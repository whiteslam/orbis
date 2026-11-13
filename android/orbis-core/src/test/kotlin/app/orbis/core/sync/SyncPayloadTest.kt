package app.orbis.core.sync

import app.orbis.core.rules.Source
import app.orbis.core.store.LedgerDay
import app.orbis.core.store.PendingSignal
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Calendar
import java.util.TimeZone

class SyncPayloadTest {
    // Gradle runs unit tests in the module directory (android/orbis-core).
    private val fixture = File("../../tests/fixtures/device-sync.json")

    private fun utc(y: Int, mo: Int, d: Int, h: Int, mi: Int, s: Int, ms: Int): Long =
        Calendar.getInstance(TimeZone.getTimeZone("UTC")).run {
            clear()
            set(y, mo - 1, d, h, mi, s)
            set(Calendar.MILLISECOND, ms)
            timeInMillis
        }

    private fun signal(id: String, at: Long, content: String) =
        PendingSignal(id, Source.TEST, "test_item", at, content, createdAt = at)

    private fun JSONObject.keyNames(): Set<String> = keys().asSequence().toSet()

    /** Null when the trees are the same, whatever the key order; else where they differ. */
    private fun diff(a: Any?, b: Any?, path: String = "$"): String? = when {
        a is JSONObject && b is JSONObject -> {
            if (a.keyNames() != b.keyNames()) "$path keys ${a.keyNames()} != ${b.keyNames()}"
            else a.keyNames().asSequence().firstNotNullOfOrNull { diff(a.get(it), b.get(it), "$path.$it") }
        }
        a is JSONArray && b is JSONArray -> {
            if (a.length() != b.length()) "$path length ${a.length()} != ${b.length()}"
            else (0 until a.length()).asSequence().firstNotNullOfOrNull { diff(a.get(it), b.get(it), "$path[$it]") }
        }
        a is Number && b is Number -> if (a.toLong() == b.toLong()) null else "$path $a != $b"
        else -> if (a == b) null else "$path $a != $b"
    }

    @Test
    fun serialisingTheObjectsBehindTheFixtureGivesTheFixture() {
        val body = SyncPayload.toJson(
            meta = SyncMeta(appVersion = "0.1.0", pushToken = "fcm-token-fixture-0001"),
            sources = listOf(SourceState(Source.TEST, true)),
            signals = listOf(
                signal("7b0f6c1e-3a52-4c8e-9d41-2f6a8b1c0001", utc(2026, 11, 12, 8, 15, 30, 250), "Test item one"),
                signal(
                    "7b0f6c1e-3a52-4c8e-9d41-2f6a8b1c0002",
                    utc(2026, 11, 12, 9, 0, 0, 0),
                    "Test item two, with emoji \uD83D\uDE00 and caf\u00E9",
                ),
            ),
            ledger = listOf(LedgerDay("2026-11-12", Source.TEST, kept = 2, dropped = 1, actions = 0)),
        )
        val expected = JSONObject(fixture.readText(Charsets.UTF_8))
        // The fixture's second time has no fraction (the server accepts both); the phone always sends milliseconds.
        val signals = expected.getJSONArray("signals")
        for (i in 0 until signals.length()) {
            val s = signals.getJSONObject(i)
            val at = s.getString("occurredAt")
            if (!at.contains('.')) s.put("occurredAt", at.removeSuffix("Z") + ".000Z")
        }
        assertEquals(null, diff(JSONObject(body), expected))
    }

    @Test
    fun metaOmitsWhatItDoesNotHave() {
        val body = JSONObject(SyncPayload.toJson(SyncMeta(appVersion = "1.2.3", pushToken = null), emptyList(), emptyList(), emptyList()))
        val meta = body.getJSONObject("meta")
        assertEquals("1.2.3", meta.getString("appVersion"))
        assertFalse(meta.has("pushToken"))
        val bare = JSONObject(SyncPayload.toJson(SyncMeta(null, null), emptyList(), emptyList(), emptyList()))
        assertEquals(0, bare.getJSONObject("meta").length())
        assertEquals(0, bare.getJSONArray("signals").length())
    }

    @Test
    fun aBlankPushTokenIsNotSent() {
        // An empty token would clear the server's stored one.
        val body = JSONObject(SyncPayload.toJson(SyncMeta("1", ""), emptyList(), emptyList(), emptyList()))
        assertFalse(body.getJSONObject("meta").has("pushToken"))
    }

    @Test
    fun timesAreUtcWithMillisecondsAndAZ() {
        assertEquals("2026-11-12T08:15:30.250Z", SyncPayload.iso(utc(2026, 11, 12, 8, 15, 30, 250)))
        assertEquals("1970-01-01T00:00:00.000Z", SyncPayload.iso(0))
        assertTrue(SyncPayload.iso(utc(2026, 1, 5, 23, 59, 59, 9)).matches(Regex("""\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z""")))
    }

    @Test
    fun everySourceKeepsItsWireNameAndOrder() {
        val all = Source.values().map { SourceState(it, false) }
        val sources = JSONObject(SyncPayload.toJson(SyncMeta(null, null), all, emptyList(), emptyList())).getJSONArray("sources")
        assertEquals(9, sources.length())
        assertEquals(Source.values().map { it.wire }, (0 until 9).map { sources.getJSONObject(it).getString("source") })
    }
}
