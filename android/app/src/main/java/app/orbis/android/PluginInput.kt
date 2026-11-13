package app.orbis.android

import app.orbis.core.rules.PAUSED_FOREVER
import app.orbis.core.rules.PrivacyRules
import java.net.URI
import java.util.Locale

/** A plugin call refused with a short [code]; the page sees the code, never an exception message. */
class Rejection(val code: String) : Exception(code)

/**
 * The pure checks behind [OrbisCorePlugin], kept free of Android so the JVM tests cover them.
 * Everything the page sends is untrusted: it is checked here before it reaches the store.
 */
object PluginInput {
    const val NOT_ORBIS_ORIGIN = "not_orbis_origin"
    const val STORE_UNAVAILABLE = "store_unavailable"
    const val FAILED = "failed"
    const val INVALID_CREDENTIAL = "invalid_credential"
    const val INVALID_SOURCE = "invalid_source"
    const val INVALID_UNTIL = "invalid_until"
    const val INVALID_PRIVACY = "invalid_privacy"
    const val INVALID_TEXT = "invalid_text"
    const val INVALID_TOKEN = "invalid_token"
    const val INVALID_LIMIT = "invalid_limit"
    const val NO_ACTIVITY = "no_activity"

    /** The page's form of [PAUSED_FOREVER]: `pause({until: -1})`, and `pausedUntil: -1` in answers. */
    const val PAGE_PAUSED_FOREVER = -1L

    const val MAX_LIST_ITEMS = 500
    const val MAX_ITEM_CHARS = 200
    const val MAX_TEST_TEXT_CHARS = 10_000
    const val MAX_PUSH_TOKEN_CHARS = 4096
    const val DEFAULT_ACTIVITY_LIMIT = 50
    const val MAX_ACTIVITY_LIMIT = 500

    private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val SECRET = Regex("^[A-Za-z0-9_-]{43}$")

    /**
     * True when [current] (the WebView's URL) has the same origin as [server] (the app's configured
     * server URL): same scheme, host and effective port. Anything unparsable is false.
     */
    fun sameOrigin(current: String?, server: String?): Boolean {
        val a = origin(current) ?: return false
        val b = origin(server) ?: return false
        return a == b
    }

    private fun origin(url: String?): Triple<String, String, Int>? {
        if (url.isNullOrBlank()) return null
        return try {
            val uri = URI(url)
            val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
            if (scheme != "https" && scheme != "http") return null
            val host = uri.host?.lowercase(Locale.ROOT)?.trimEnd('.') ?: return null
            if (host.isEmpty()) return null
            val port = if (uri.port != -1) uri.port else if (scheme == "https") 443 else 80
            Triple(scheme, host, port)
        } catch (_: Exception) {
            null
        }
    }

    /** `deviceId` and `userId` are UUIDs; the secret is 43 base64url characters (32 bytes). */
    fun validCredential(deviceId: Any?, secret: Any?, userId: Any?): Boolean =
        deviceId is String && UUID.matches(deviceId) &&
            userId is String && UUID.matches(userId) &&
            secret is String && SECRET.matches(secret)

    /**
     * `pause({until})` to the store's pausedUntil: 0 resumes (null), -1 is [PAUSED_FOREVER], a positive
     * whole number is epoch ms. Anything else (other negatives, fractions, non-numbers) is refused.
     */
    fun pausedUntil(raw: Any?): Long? {
        val until = wholeNumber(raw) ?: throw Rejection(INVALID_UNTIL)
        return when {
            until == 0L -> null
            until == PAGE_PAUSED_FOREVER -> PAUSED_FOREVER
            until > 0L && until != PAUSED_FOREVER -> until
            else -> throw Rejection(INVALID_UNTIL)
        }
    }

    /** The store's pausedUntil as the page sees it: null, -1 (until turned back on) or epoch ms. */
    fun pausedUntilForPage(pausedUntil: Long?): Long? =
        if (pausedUntil == PAUSED_FOREVER) PAGE_PAUSED_FOREVER else pausedUntil

    /** `recentActivity({limit})`: missing gives [DEFAULT_ACTIVITY_LIMIT]; otherwise 1..[MAX_ACTIVITY_LIMIT]. */
    fun activityLimit(raw: Any?): Int {
        if (raw == null) return DEFAULT_ACTIVITY_LIMIT
        val n = wholeNumber(raw) ?: throw Rejection(INVALID_LIMIT)
        if (n < 1 || n > MAX_ACTIVITY_LIMIT) throw Rejection(INVALID_LIMIT)
        return n.toInt()
    }

    /**
     * One list from `setPrivacy`: null when the page left it out (keep the saved one), else the
     * trimmed, non-blank, de-duplicated items. Too many items, too long an item or a non-string
     * is refused.
     */
    fun list(raw: List<Any?>?): List<String>? {
        if (raw == null) return null
        if (raw.size > MAX_LIST_ITEMS) throw Rejection(INVALID_PRIVACY)
        return raw.map { item ->
            if (item !is String) throw Rejection(INVALID_PRIVACY)
            val trimmed = item.trim()
            if (trimmed.length > MAX_ITEM_CHARS) throw Rejection(INVALID_PRIVACY)
            trimmed
        }.filter { it.isNotEmpty() }.distinct()
    }

    /** Blocked contacts are saved as [PrivacyRules.contactKey]s; blank keys are dropped. */
    fun contactKeys(items: List<String>): Set<String> =
        items.map(PrivacyRules::contactKey).filter { it.isNotEmpty() }.toSet()

    /** testCapture's text: a string of at most [MAX_TEST_TEXT_CHARS] characters. */
    fun testText(raw: Any?): String {
        if (raw !is String || raw.length > MAX_TEST_TEXT_CHARS) throw Rejection(INVALID_TEXT)
        return raw
    }

    /** An optional short string (testCapture's app or contact): absent or blank gives null. */
    fun optionalShort(raw: Any?): String? {
        if (raw == null) return null
        if (raw !is String || raw.length > MAX_ITEM_CHARS) throw Rejection(INVALID_TEXT)
        return raw.trim().ifEmpty { null }
    }

    /** setPushToken's token: non-blank, at most [MAX_PUSH_TOKEN_CHARS] characters. */
    fun pushToken(raw: Any?): String {
        if (raw !is String || raw.isBlank() || raw.length > MAX_PUSH_TOKEN_CHARS) throw Rejection(INVALID_TOKEN)
        return raw
    }

    /** A JSON number with no fraction, as a Long (org.json gives Integer, Long or Double). */
    private fun wholeNumber(raw: Any?): Long? = when (raw) {
        is Int -> raw.toLong()
        is Long -> raw
        is Double -> if (raw.isFinite() && raw == Math.floor(raw) && kotlin.math.abs(raw) < 9.0e15) raw.toLong() else null
        else -> null
    }
}
