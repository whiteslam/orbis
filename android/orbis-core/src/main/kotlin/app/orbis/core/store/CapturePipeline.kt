package app.orbis.core.store

import app.orbis.core.notify.NotificationSorter
import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import app.orbis.core.rules.DropReason
import app.orbis.core.rules.PrivacyRules
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import java.util.UUID

/**
 * Runs the privacy rules on a captured item and stores the result.
 *
 * - Keep: a [RawItem] (masked text, package, contact keys), a [PendingSignal] (unless its
 *   content is empty) and a "kept" ledger row. A notification instead gets a signal only when
 *   [NotificationSorter] recognises it (a payment, delivery, missed call, job mail), and a
 *   one-time code is dropped (ledger row only, reason ONE_TIME_CODE).
 * - Drop: only `LedgerEntry(at, source, "dropped", reason)`. No package, contact or text.
 */
class CapturePipeline(private val port: StorePort) {
    suspend fun capture(item: CapturedItem, settings: PrivacySettings, now: Long): Decision =
        store(item, settings, now, digest = null)

    /**
     * [capture] for a posted notification with its `NotificationReader.digest`, read once: null,
     * with nothing written, when that digest was already kept. A kept one's digest is remembered
     * (in the caller's transaction, with its rows) and names its signal ([signalIdFor]). A dropped
     * one leaves no digest: nothing about a dropped item is stored.
     */
    suspend fun captureOnce(item: CapturedItem, digest: String, settings: PrivacySettings, now: Long): Decision? {
        if (port.seen(digest)) return null
        val decision = store(item, settings, now, digest)
        if (decision is Decision.Keep) port.markSeen(digest, now)
        return decision
    }

    private suspend fun store(item: CapturedItem, settings: PrivacySettings, now: Long, digest: String?): Decision {
        val decision = PrivacyRules.decide(item, settings, now)
        when (decision) {
            is Decision.Drop -> port.insertDropped(
                LedgerEntry(at = now, source = item.source, decision = LedgerEntry.DROPPED, reason = decision.reason.name),
            )
            is Decision.Keep -> {
                val masked = decision.maskedText
                val raw = RawItem(
                    source = item.source,
                    packageName = item.packageName,
                    contactKeys = item.contacts.map(PrivacyRules::contactKey).filter { it.isNotEmpty() }.joinToString("\n"),
                    text = masked,
                    occurredAt = item.occurredAt,
                    capturedAt = now,
                )
                val signal = if (item.source == Source.NOTIFICATIONS) {
                    // A one-time code is never kept, not even masked.
                    if (NotificationSorter.isOneTimeCode(item.text)) {
                        port.insertDropped(
                            LedgerEntry(at = now, source = item.source, decision = LedgerEntry.DROPPED, reason = DropReason.ONE_TIME_CODE.name),
                        )
                        return Decision.Drop(DropReason.ONE_TIME_CODE)
                    }
                    NotificationSorter.sort(item.packageName, item.text, masked)?.let {
                        PendingSignal(
                            id = digest?.let(::signalIdFor) ?: UUID.randomUUID().toString(),
                            source = item.source,
                            kind = it.kind,
                            occurredAt = item.occurredAt,
                            content = it.content, // already safe for the server
                            createdAt = now,
                        )
                    }
                } else {
                    val content = signalContent(masked)
                    if (content.isEmpty()) {
                        null
                    } else {
                        PendingSignal(
                            id = UUID.randomUUID().toString(),
                            source = item.source,
                            kind = kindFor(item.source),
                            occurredAt = item.occurredAt,
                            content = content,
                            createdAt = now,
                        )
                    }
                }
                port.insertKept(raw, signal, LedgerEntry(at = now, source = item.source, decision = LedgerEntry.KEPT, reason = null))
            }
        }
        return decision
    }

    companion object {
        /** The server's limit on signal content, in UTF-16 units. */
        const val MAX_CONTENT_CHARS = 4000

        /** The signal kind for a source: `test_item`, `notifications_item`, ... */
        fun kindFor(source: Source): String = "${source.wire}_item"

        /**
         * A notification's signal id: a name-based (version 3) UUID of its digest, lowercase. The
         * same notification always gets the same id, so if the phone ever reads it twice, the
         * server's "on conflict do nothing" on (user_id, id) keeps one signal (a second guard
         * behind the seen_notification table).
         */
        fun signalIdFor(digest: String): String = UUID.nameUUIDFromBytes(digest.toByteArray(Charsets.UTF_8)).toString()

        /**
         * Masked text made safe for the server: NUL removed, lone surrogates replaced with
         * U+FFFD (the server refuses both), then cut to [MAX_CONTENT_CHARS] without splitting a
         * surrogate pair. May be empty. [max] is the cut length (the server's limit by default).
         */
        fun signalContent(masked: String, max: Int = MAX_CONTENT_CHARS): String {
            val out = StringBuilder(minOf(masked.length, max + 1))
            var i = 0
            while (i < masked.length && out.length < max + 1) {
                val c = masked[i]
                when {
                    c == '\u0000' -> i++
                    c.isHighSurrogate() && i + 1 < masked.length && masked[i + 1].isLowSurrogate() -> {
                        out.append(c).append(masked[i + 1])
                        i += 2
                    }
                    c.isSurrogate() -> {
                        out.append('\uFFFD')
                        i++
                    }
                    else -> {
                        out.append(c)
                        i++
                    }
                }
            }
            if (out.length > max) {
                out.setLength(max)
                if (max > 0 && out[max - 1].isHighSurrogate()) out.setLength(max - 1)
            }
            return out.toString()
        }
    }
}
