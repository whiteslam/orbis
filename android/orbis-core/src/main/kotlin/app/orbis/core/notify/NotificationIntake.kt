package app.orbis.core.notify

import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import kotlin.coroutines.cancellation.CancellationException

/**
 * What the listener does with one posted notification, with its dependencies passed in so it runs
 * (and is tested) without Android. A failure anywhere (store won't open, keystore, full disk, work
 * scheduling) is logged by class name and swallowed: the listener runs for every notification, and
 * an exception escaping its coroutine would kill the whole app process. The message is never
 * logged, as it could carry notification text.
 */
class NotificationIntake(
    private val ownPackage: String,
    private val recent: RecentKeys,
    private val sourceEnabled: suspend () -> Boolean,
    private val capture: suspend (CapturedItem) -> Decision,
    private val syncNow: () -> Unit,
    private val logFailure: (String) -> Unit,
) {
    suspend fun handle(facts: NotificationFacts) {
        try {
            if (!sourceEnabled()) return
            val item = NotificationReader.toItem(facts, ownPackage) ?: return
            if (!recent.firstTime(facts.key, item.text)) return
            val decision = capture(item)
            if (decision is Decision.Keep &&
                NotificationSorter.sort(item.packageName, item.text, item.text)?.kind == "transaction"
            ) {
                syncNow()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logFailure("capture failed: ${e.javaClass.name}")
        }
    }

    companion object {
        /**
         * Runs [read], which copies the facts out of the Android notification, and returns null
         * if it throws. Reading the extras can unparcel an app's custom objects and throw (e.g.
         * BadParcelableException on Android 12 and older); uncaught on the main thread, that
         * would kill the app every time the notification is posted again. Logs the exception's
         * class name only, never the text.
         */
        inline fun readSafely(logFailure: (String) -> Unit, read: () -> NotificationFacts): NotificationFacts? =
            try {
                read()
            } catch (e: Exception) {
                logFailure("read failed: ${e.javaClass.name}")
                null
            }
    }
}
