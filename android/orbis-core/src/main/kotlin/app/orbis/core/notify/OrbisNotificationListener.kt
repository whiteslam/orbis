package app.orbis.core.notify

import android.app.Notification
import android.os.Process
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import app.orbis.core.rules.Decision
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
        val extras = sbn.notification.extras
        val facts = NotificationFacts(
            key = sbn.key,
            packageName = sbn.packageName,
            title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            bigText = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            postTime = sbn.postTime,
            ongoing = sbn.isOngoing,
            groupSummary = (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
            otherProfile = sbn.user != Process.myUserHandle(),
        )
        val context = applicationContext
        scope.launch {
            val store = OrbisStore.get(context)
            if (!store.sourceEnabled(Source.NOTIFICATIONS)) return@launch
            val item = NotificationReader.toItem(facts, context.packageName) ?: return@launch
            if (!recent.firstTime(facts.key, item.text)) return@launch
            val decision = store.capture(item)
            if (decision is Decision.Keep &&
                NotificationSorter.sort(item.packageName, item.text, item.text)?.kind == "transaction"
            ) {
                SyncScheduler.now(context)
            }
        }
    }
}
