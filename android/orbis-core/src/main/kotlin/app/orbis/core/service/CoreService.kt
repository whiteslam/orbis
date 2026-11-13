package app.orbis.core.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import app.orbis.core.R
import app.orbis.core.store.OrbisStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The foreground service that keeps Orbis alive while at least one source is on. It does no capture
 * itself yet: the capture sources (later tasks) run while it is up. Started and stopped only by
 * [CoreController.reconcile].
 *
 * Android needs startForeground within seconds of the start, so it posts a plain "Orbis is active"
 * notification first, then reads the settings and adds the source labels. If the settings say it should
 * not run (e.g. the owner switched the last source off in the meantime) it stops itself.
 *
 * On Android 13+ without the notification permission the service still runs; the notification is hidden.
 */
class CoreService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            startInForeground(buildNotification(this, text = null))
        } catch (e: Exception) {
            // Android refused the foreground start (e.g. ForegroundServiceStartNotAllowedException from
            // the background on 12+, or a SecurityException). Don't crash the app: stop, and don't ask to
            // be restarted. The next reconcile (the app opening, a boot) tries again. Class name only.
            Log.w(TAG, "startForeground refused: ${e.javaClass.name}")
            stopSelf()
            return START_NOT_STICKY
        }
        scope.launch { refresh() }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun startInForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private suspend fun refresh() {
        try {
            val store = OrbisStore.get(this)
            val settings = store.settings()
            val hasCredential = store.credential() != null
            if (!ServicePolicy.shouldRun(settings, System.currentTimeMillis(), hasCredential)) {
                stopSelf()
                return
            }
            getSystemService(NotificationManager::class.java)
                .notify(NOTIFICATION_ID, buildNotification(this, ServicePolicy.notificationText(settings)))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A transient keystore failure: keep the plain notification; the next reconcile fixes the text.
            Log.w(TAG, "refresh failed: ${e.javaClass.name}")
        }
    }

    companion object {
        const val CHANNEL_ID = "orbis_active"
        const val NOTIFICATION_ID = 1001
        private const val TAG = "OrbisService"

        internal fun buildNotification(context: Context, text: String?): Notification {
            if (Build.VERSION.SDK_INT >= 26) {
                val channel = NotificationChannel(CHANNEL_ID, "Orbis is active", NotificationManager.IMPORTANCE_LOW)
                context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
            }
            val builder = if (Build.VERSION.SDK_INT >= 26) {
                Notification.Builder(context, CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
            }
            builder.setSmallIcon(R.drawable.ic_orbis_active)
                .setContentTitle("Orbis is active")
                .setOngoing(true)
                .setShowWhen(false)
            if (text != null) builder.setContentText(text)
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
                builder.setContentIntent(
                    PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
                )
            }
            return builder.build()
        }
    }
}
