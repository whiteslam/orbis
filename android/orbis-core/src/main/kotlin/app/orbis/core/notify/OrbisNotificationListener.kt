package app.orbis.core.notify

import android.app.Notification
import android.app.Person
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import app.orbis.core.rules.Source
import app.orbis.core.store.OrbisStore
import app.orbis.core.sync.SyncScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Reads posted notifications into the capture pipeline. Thin on purpose: the choosing is in
 * [NotificationReader], the privacy rules and the sorting in the store. Nothing is read while the
 * notifications source is off, and notification text is never logged.
 */
class OrbisNotificationListener : NotificationListenerService() {
    @Volatile private var scope = newScope()
    private val recent = RecentKeys()

    private fun newScope() = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onListenerConnected() {
        // After a disconnect the old scope is cancelled; take a fresh one for the new connection.
        if (scope.coroutineContext[Job]?.isActive == false) scope = newScope()
    }

    override fun onListenerDisconnected() {
        scope.cancel()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        // Everything read from the notification is inside readSafely: an app's bad extras must
        // not crash Orbis (this runs on the main thread, outside the coroutine's catch).
        val facts = NotificationIntake.readSafely({ Log.w(TAG, it) }) { factsOf(sbn) } ?: return
        val context = applicationContext
        scope.launch {
            NotificationIntake(
                ownPackage = context.packageName,
                recent = recent,
                sourceEnabled = { OrbisStore.get(context).sourceEnabled(Source.NOTIFICATIONS) },
                capture = { OrbisStore.get(context).capture(it) },
                syncNow = { SyncScheduler.now(context) },
                logFailure = { Log.w(TAG, it) },
            ).handle(facts)
        }
    }

    private fun factsOf(sbn: StatusBarNotification): NotificationFacts {
        val extras = sbn.notification.extras
        return NotificationFacts(
            key = sbn.key,
            packageName = sbn.packageName,
            title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            bigText = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            postTime = sbn.postTime,
            ongoing = sbn.isOngoing,
            groupSummary = (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
            otherProfile = sbn.user != Process.myUserHandle(),
            handles = if (extras == null) emptyList() else handlesOf(extras),
        )
    }

    /**
     * The people a notification carries besides its title, for the blocked-contact check: phone
     * numbers from `tel:` people (EXTRA_PEOPLE_LIST on Android 9+, EXTRA_PEOPLE before), those
     * people's names, and the sender of each messaging-style message. Runs inside readSafely.
     */
    @Suppress("DEPRECATION") // the typed getters arrived in API 33; minSdk is 24
    private fun handlesOf(extras: Bundle): List<String> {
        val out = mutableListOf<String>()
        fun person(p: Person?) {
            if (p == null) return
            p.name?.toString()?.let(out::add)
            NotificationReader.phoneFromUri(p.uri)?.let(out::add)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            extras.getParcelableArrayList<Person>(Notification.EXTRA_PEOPLE_LIST)?.forEach(::person)
        }
        extras.getStringArray(Notification.EXTRA_PEOPLE)?.forEach { uri ->
            NotificationReader.phoneFromUri(uri)?.let(out::add)
        }
        extras.getParcelableArray(Notification.EXTRA_MESSAGES)?.forEach { message ->
            val bundle = message as? Bundle ?: return@forEach
            bundle.getCharSequence(MESSAGE_SENDER)?.toString()?.let(out::add)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                person(bundle.getParcelable(MESSAGE_SENDER_PERSON) as? Person)
            }
        }
        return out
    }

    private companion object {
        const val TAG = "OrbisNotifications"

        // Notification.MessagingStyle.Message's bundle keys (not public constants).
        const val MESSAGE_SENDER = "sender"
        const val MESSAGE_SENDER_PERSON = "sender_person"
    }
}
