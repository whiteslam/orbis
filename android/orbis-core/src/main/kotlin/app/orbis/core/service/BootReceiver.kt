package app.orbis.core.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the service after a reboot or an app update. Both broadcasts are exempt from Android's
 * background-start limits. The work is async (the store is encrypted and suspend), so the broadcast is
 * held open with goAsync until reconcile is done.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        CoreController.reconcileAsync(context) { pending.finish() }
    }
}
