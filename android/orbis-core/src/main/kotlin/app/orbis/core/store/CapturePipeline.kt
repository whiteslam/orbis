package app.orbis.core.store

import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import app.orbis.core.rules.PrivacyRules
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import java.util.UUID

/**
 * Runs the privacy rules on a captured item and stores the result.
 *
 * - Keep: a [RawItem] (masked text, package, contact keys), a [PendingSignal] (unless its
 *   content is empty) and a "kept" ledger row.
 * - Drop: only `LedgerEntry(at, source, "dropped", reason)`. No package, contact or text.
 */
class CapturePipeline(private val port: StorePort) {
    suspend fun capture(item: CapturedItem, settings: PrivacySettings, now: Long): Decision {
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
                val content = signalContent(masked)
                val signal = if (content.isEmpty()) {
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
