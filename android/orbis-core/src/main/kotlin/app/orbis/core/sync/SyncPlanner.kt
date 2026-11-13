package app.orbis.core.sync

import app.orbis.core.store.PendingSignal

/**
 * Splits the outbox into requests. The server takes at most 100 signals and 256 KB of body per
 * request. [maxBytes] counts the signals only; its default leaves about 56 KB of room under the
 * server's cap for the rest of the body (meta with a 4 KB token, 9 sources, at most 90 ledger rows:
 * under 15 KB).
 */
object SyncPlanner {
    const val MAX_COUNT = 100
    const val MAX_BYTES = 200_000

    fun batches(
        pending: List<PendingSignal>,
        maxCount: Int = MAX_COUNT,
        maxBytes: Int = MAX_BYTES,
    ): List<List<PendingSignal>> {
        val out = mutableListOf<List<PendingSignal>>()
        var current = mutableListOf<PendingSignal>()
        var bytes = 0
        for (signal in pending) {
            val size = SyncPayload.signalBytes(signal)
            // One signal is at most ~16 KB (4,000 characters), so a lone item over the cap is only a
            // sanity case: it still gets a batch of its own rather than being lost.
            if (current.isNotEmpty() && (current.size >= maxCount || bytes + size > maxBytes)) {
                out += current
                current = mutableListOf()
                bytes = 0
            }
            current += signal
            bytes += size
        }
        if (current.isNotEmpty()) out += current
        return out
    }
}
