package app.orbis.core.notify

import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.PrivacyRules
import app.orbis.core.rules.Source
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/**
 * The parts of a posted notification Orbis looks at, copied out of the Android object so this
 * stays pure. [handles] are the people the listener found in the notification's extras: numbers
 * from `tel:` people and senders of messaging-style messages. They only feed the blocked-contact
 * check (and the raw item's contact keys). [whenTime] is the notification's own `when`, which an
 * app keeps when it posts the same notification again (after a reboot, say); [postTime] is not.
 */
data class NotificationFacts(
    val key: String,
    val packageName: String,
    val title: String?,
    val text: String?,
    val bigText: String?,
    val postTime: Long,
    val whenTime: Long,
    val ongoing: Boolean,
    val groupSummary: Boolean,
    val otherProfile: Boolean,
    val handles: List<String> = emptyList(),
)

object NotificationReader {
    private const val TEL = "tel:"

    /**
     * A fingerprint of one notification, for the store to remember it was read: SHA-256 (64
     * lowercase hex characters) over the app, the notification's key, its `when` and its words.
     * Each field goes in as its length, NUL, the field, so no two field lists give the same input.
     * The post time is left out on purpose: it changes every time the app posts it again.
     */
    fun digest(f: NotificationFacts): String {
        val fields = listOf(f.packageName, f.key, f.whenTime.toString(), f.title.orEmpty(), (f.bigText ?: f.text).orEmpty())
        val input = fields.joinToString("") { "${it.length}\u0000$it\u0000" }
        val hash = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return hash.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

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
 * The [NotificationReader.digest]s of the last [capacity] notifications this process handled, so
 * one an app refreshes with the same words skips the store. Only a cheap first filter: it is empty
 * after a restart, so the store's seen_notification table is the real guard. Least recently seen
 * goes first. Calls are synchronised.
 */
class RecentKeys(private val capacity: Int = 200) {
    private val seen = object : LinkedHashMap<String, Unit>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Unit>?) = size > capacity
    }

    /** Whether [digest] was remembered (and is still among the last [capacity]). */
    @Synchronized
    fun contains(digest: String): Boolean = seen[digest] != null

    /** Remembers [digest]. Call it only once the notification was handled. */
    @Synchronized
    fun remember(digest: String) {
        seen[digest] = Unit
    }
}
