package app.orbis.core.sync

import app.orbis.core.rules.Source
import app.orbis.core.store.LedgerDay
import app.orbis.core.store.PendingSignal
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** The sync request's `meta`. A null (or, for the token, blank) value is left out of the JSON. */
data class SyncMeta(val appVersion: String?, val pushToken: String?)

/** One source and whether the owner has it on, as the phone's settings say. */
data class SourceState(val source: Source, val enabled: Boolean)

/**
 * The body of `POST /api/device/signals`. Its shape is the contract in
 * `tests/fixtures/device-sync.json`, checked by SyncPayloadTest and by the server's `parseSync`.
 */
object SyncPayload {
    fun toJson(
        meta: SyncMeta,
        sources: List<SourceState>,
        signals: List<PendingSignal>,
        ledger: List<LedgerDay>,
    ): String = JSONObject()
        .put("meta", metaJson(meta))
        .put("sources", JSONArray().also { a -> sources.forEach { a.put(sourceJson(it)) } })
        .put("signals", JSONArray().also { a -> signals.forEach { a.put(signalJson(it)) } })
        .put("ledger", JSONArray().also { a -> ledger.forEach { a.put(ledgerJson(it)) } })
        .toString()

    /** UTF-8 bytes one signal adds to a request body (its JSON plus the comma between items). */
    fun signalBytes(signal: PendingSignal): Int = signalJson(signal).toString().toByteArray(Charsets.UTF_8).size + 1

    /** ISO-8601 in UTC with milliseconds and a `Z`, e.g. `2026-11-12T08:15:30.250Z`. */
    fun iso(epochMs: Long): String {
        // SimpleDateFormat is not thread-safe, so make one per call; syncs are rare.
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(epochMs))
    }

    private fun metaJson(m: SyncMeta) = JSONObject().apply {
        if (!m.appVersion.isNullOrEmpty()) put("appVersion", m.appVersion)
        // An empty token would clear the one the server holds, so a blank one is never sent.
        if (!m.pushToken.isNullOrBlank()) put("pushToken", m.pushToken)
    }

    private fun sourceJson(s: SourceState) = JSONObject().put("source", s.source.wire).put("enabled", s.enabled)

    private fun signalJson(s: PendingSignal) = JSONObject()
        .put("id", s.id)
        .put("source", s.source.wire)
        .put("kind", s.kind)
        .put("occurredAt", iso(s.occurredAt))
        .put("content", s.content)

    private fun ledgerJson(d: LedgerDay) = JSONObject()
        .put("day", d.day)
        .put("source", d.source.wire)
        .put("kept", d.kept)
        .put("dropped", d.dropped)
        .put("actions", d.actions)
}
