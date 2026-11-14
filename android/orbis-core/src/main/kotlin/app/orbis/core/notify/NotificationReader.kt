package app.orbis.core.notify

import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Source

/** The parts of a posted notification Orbis looks at, copied out of the Android object so this stays pure. */
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
)

object NotificationReader {
    /**
     * The item to run through the privacy rules, or null for what is never read: Orbis's own
     * notifications, ongoing ones (music, navigation), group summaries (their children arrive on
     * their own) and notifications with no words.
     */
    fun toItem(f: NotificationFacts, ownPackage: String): CapturedItem? {
        if (f.packageName == ownPackage || f.ongoing || f.groupSummary) return null
        if (f.title.isNullOrBlank() && f.text.isNullOrBlank() && f.bigText.isNullOrBlank()) return null
        return CapturedItem(
            source = Source.NOTIFICATIONS,
            packageName = f.packageName,
            contacts = listOfNotNull(f.title),
            text = listOfNotNull(f.title, f.bigText ?: f.text).joinToString("\n"),
            occurredAt = f.postTime,
            fromOtherProfile = f.otherProfile,
        )
    }
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
