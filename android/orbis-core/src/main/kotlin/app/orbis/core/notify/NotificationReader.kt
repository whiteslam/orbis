package app.orbis.core.notify

import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.PrivacyRules
import app.orbis.core.rules.Source
import java.io.ByteArrayOutputStream

/**
 * The parts of a posted notification Orbis looks at, copied out of the Android object so this
 * stays pure. [handles] are the people the listener found in the notification's extras: numbers
 * from `tel:` people and senders of messaging-style messages. They only feed the blocked-contact
 * check (and the raw item's contact keys).
 */
data class NotificationFacts(
    val key: String,
    val packageName: String,
    val title: String?,
    val text: String?,
    val bigText: String?,
    val postTime: Long,
    val ongoing: Boolean,
    val groupSummary: Boolean,
    val otherProfile: Boolean,
    val handles: List<String> = emptyList(),
)

object NotificationReader {
    private const val TEL = "tel:"

    /**
     * The item to run through the privacy rules, or null for what is never read: Orbis's own
     * notifications, ongoing ones (music, navigation), group summaries (their children arrive on
     * their own) and notifications with no words.
     */
    fun toItem(f: NotificationFacts, ownPackage: String): CapturedItem? {
        if (f.packageName == ownPackage || f.ongoing || f.groupSummary) return null
        if (f.title.isNullOrBlank() && f.text.isNullOrBlank() && f.bigText.isNullOrBlank()) return null
        val body = f.bigText ?: f.text
        return CapturedItem(
            source = Source.NOTIFICATIONS,
            packageName = f.packageName,
            contacts = contactsOf(f, body),
            text = listOfNotNull(f.title, body).joinToString("\n"),
            occurredAt = f.postTime,
            fromOtherProfile = f.otherProfile,
        )
    }

    /**
     * Everyone a notification names, so a blocked contact is caught however the app shows them:
     * the title; the sender in a group title ("Family: Asha"); a phone app's caller, who is in the
     * text ("Missed call" / "+91 98765 43210", or "Missed call from Asha"); and the listener's
     * [NotificationFacts.handles]. Trimmed, blanks dropped, one per contact key.
     */
    private fun contactsOf(f: NotificationFacts, body: String?): List<String> {
        val groupSender = f.title?.substringAfterLast(": ", "")
        val callers = if (f.packageName in NotificationSorter.PHONE_DIALERS) {
            listOfNotNull(f.title, body).flatMap { it.lines() }.mapNotNull(NotificationSorter::callerOn)
        } else {
            emptyList()
        }
        return (listOfNotNull(f.title, groupSender) + callers + f.handles)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinctBy { PrivacyRules.contactKey(it) }
    }

    /** The phone number in a `tel:` URI (percent-decoded), or null for any other URI. */
    fun phoneFromUri(uri: String?): String? {
        if (uri == null || !uri.startsWith(TEL, ignoreCase = true)) return null
        return percentDecode(uri.substring(TEL.length)).trim().takeIf { it.isNotEmpty() }
    }

    /** Decodes `%XX` escapes (runs of them as UTF-8); everything else is kept as it is. */
    private fun percentDecode(s: String): String {
        val out = StringBuilder()
        val bytes = ByteArrayOutputStream()
        fun flush() {
            if (bytes.size() > 0) out.append(bytes.toString(Charsets.UTF_8.name()))
            bytes.reset()
        }
        var i = 0
        while (i < s.length) {
            if (s[i] == '%' && i + 2 < s.length && isHex(s[i + 1]) && isHex(s[i + 2])) {
                bytes.write(s.substring(i + 1, i + 3).toInt(16))
                i += 3
            } else {
                flush()
                out.append(s[i])
                i++
            }
        }
        flush()
        return out.toString()
    }

    private fun isHex(c: Char) = c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F'
}

/**
 * Remembers the last [capacity] notifications (key plus text) so one that is posted again with
 * the same words, as apps do when they refresh a notification, is read once. Least recently seen
 * goes first. Not thread-safe on its own: calls are synchronised.
 */
class RecentKeys(private val capacity: Int = 200) {
    private val seen = object : LinkedHashMap<String, Unit>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Unit>?) = size > capacity
    }

    /** True the first time [key] with [text] is seen (and remembers it), false after that. */
    @Synchronized
    fun firstTime(key: String, text: String): Boolean = seen.put(key + text.hashCode(), Unit) == null
}
