package app.orbis.core.sync

/** What one request's answer means for the batch it carried. */
sealed class SyncOutcome {
    /** Accepted, or refused for good: the batch leaves the outbox. */
    object Done : SyncOutcome()

    /** The server no longer knows this phone: sign out. */
    object Revoked : SyncOutcome()

    /** Try again later; the batch stays. */
    object Retry : SyncOutcome()

    companion object {
        fun from(httpStatus: Int): SyncOutcome = when (httpStatus) {
            in 200..299 -> Done
            // Only 401: the server answers it for an unknown or revoked phone and never sends 403. A 403 can
            // come from a firewall or proxy, where wiping the phone would be destructive, so it retries.
            401 -> Revoked
            // A request the server can never accept (unparseable, or over 256 KB). Dropping the batch
            // means one bad item cannot wedge the queue forever.
            400, 413 -> Done
            else -> Retry
        }

        /** True for the statuses that drop a batch without the server having accepted it. */
        fun isDropped(httpStatus: Int): Boolean = httpStatus == 400 || httpStatus == 413
    }
}
