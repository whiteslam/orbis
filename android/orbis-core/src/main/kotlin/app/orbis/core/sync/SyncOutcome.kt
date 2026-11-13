package app.orbis.core.sync

import org.json.JSONException
import org.json.JSONObject

/** What one request's answer means for the batch it carried. */
sealed class SyncOutcome {
    /** Accepted (a 2xx with the server's counts), or refused for good: the batch leaves the outbox. */
    object Done : SyncOutcome()

    /** The server no longer knows this phone: sign out. */
    object Revoked : SyncOutcome()

    /** Try again later; the batch stays. */
    object Retry : SyncOutcome()

    companion object {
        /**
         * R20: a 2xx is Done only when [body] is the server's JSON counts ([isCountedReply]). Any other 2xx
         * (production's HTML page for a route that isn't deployed, a captive portal, a proxy page, a 204)
         * is Retry, so the batch stays. The other statuses don't look at the body.
         */
        fun from(httpStatus: Int, body: String?): SyncOutcome = when (httpStatus) {
            in 200..299 -> if (isCountedReply(body)) Done else Retry
            // Only 401: the server answers it for an unknown or revoked phone and never sends 403. A 403 can
            // come from a firewall or proxy, where wiping the phone would be destructive, so it retries.
            401 -> Revoked
            // A request the server can never accept (unparseable, or over 256 KB). Dropping the batch
            // means one bad item cannot wedge the queue forever.
            400, 413 -> Done
            else -> Retry
        }

        /** True when [body] is a JSON object with numeric `accepted`, `duplicate` and `refused`. */
        fun isCountedReply(body: String?): Boolean {
            if (body.isNullOrBlank()) return false
            return try {
                val o = JSONObject(body)
                FIELDS.all { o.opt(it) is Number }
            } catch (_: JSONException) {
                false
            }
        }

        /** A 2xx that isn't the server's answer: the batch is kept and the error is "unexpected response". */
        fun isUnexpected(httpStatus: Int, body: String?): Boolean = httpStatus in 200..299 && !isCountedReply(body)

        private val FIELDS = listOf("accepted", "duplicate", "refused")

        /** True for the statuses that drop a batch without the server having accepted it. */
        fun isDropped(httpStatus: Int): Boolean = httpStatus == 400 || httpStatus == 413
    }
}
