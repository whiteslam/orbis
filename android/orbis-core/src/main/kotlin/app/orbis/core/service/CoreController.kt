package app.orbis.core.service

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.store.OrbisStore
import app.orbis.core.sync.CoreHooks
import app.orbis.core.sync.SyncScheduler
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit

/**
 * Makes the phone match the saved settings: the foreground service runs exactly when
 * [ServicePolicy.shouldRun] says so, the periodic sync is scheduled, and a finite pause has an
 * `orbis-resume` job waiting for its end. Call [reconcile] after anything that changes the settings or
 * the credential. It is safe from anywhere: idempotent, quick and it never throws (except cancellation).
 */
object CoreController {
    const val RESUME_WORK_NAME = "orbis-resume"
    private const val TAG = "OrbisCore"

    private val lock = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /**
     * Points [CoreHooks.onRevoked] at [reconcile] so a revoke (which wipes the credential) stops the
     * service. Idempotent. SyncWorker calls it at the start of every run, and the revoke path only
     * ever runs inside that worker, so it is in place in every process that can revoke. The hook runs
     * reconcile to completion before returning: it is quick, and the worker may end right after.
     */
    fun install() {
        CoreHooks.onRevoked = { context -> runBlocking { reconcile(context) } }
    }

    /**
     * Start or stop [CoreService], ensure the periodic sync, and (re)schedule or cancel `orbis-resume`.
     * On a store failure the service is left as it is, and only the periodic sync is ensured (it retries).
     */
    suspend fun reconcile(context: Context) {
        val app = context.applicationContext
        try {
            // Always: the sync is what recovers from every other failure below.
            SyncScheduler.ensurePeriodic(app)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Log.w(TAG, "ensurePeriodic failed: ${e.javaClass.name}")
        }
        lock.withLock {
            val settings: PrivacySettings
            val hasCredential: Boolean
            try {
                val store = OrbisStore.get(app)
                settings = store.settings()
                hasCredential = store.credential() != null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "reconcile: store unavailable: ${e.javaClass.name}")
                return
            }
            val now = System.currentTimeMillis()
            if (ServicePolicy.shouldRun(settings, now, hasCredential)) start(app) else stop(app)
            scheduleResume(app, ServicePolicy.resumeAt(settings, now), now)
        }
    }

    /** Fire-and-forget [reconcile] for receivers and callbacks; [onDone] runs when it has finished. */
    fun reconcileAsync(context: Context, onDone: () -> Unit = {}) {
        val app = context.applicationContext
        scope.launch {
            try {
                reconcile(app)
            } finally {
                onDone()
            }
        }
    }

    /** True when Android may still restrict Orbis in the background (battery optimisation is on for it). */
    fun batteryOptimized(context: Context): Boolean {
        val power = context.getSystemService(PowerManager::class.java) ?: return true
        return !power.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Opens the battery screen. [direct] is the app's `BuildConfig.DISTRIBUTION == direct`: it asks for the
     * exemption with a prompt (the permission exists only in that manifest). The play build opens the
     * general battery-optimisation list instead. Falls back to the list if the prompt isn't available.
     */
    fun openBatterySettings(activity: Activity, direct: Boolean) {
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        if (!direct) {
            safeStart(activity, list)
            return
        }
        val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${activity.packageName}"))
        if (!safeStart(activity, request)) safeStart(activity, list)
    }

    /** Opens Orbis's page in system Settings (permissions, notifications, battery). */
    fun openAppInfo(activity: Activity) {
        safeStart(
            activity,
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:${activity.packageName}")),
        )
    }

    private fun safeStart(activity: Activity, intent: Intent): Boolean = try {
        activity.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        Log.w(TAG, "startActivity refused: ${e.javaClass.name}")
        false
    }

    private fun start(app: Context) {
        val intent = Intent(app, CoreService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(intent) else app.startService(intent)
        } catch (e: Exception) {
            // Android 12+ refuses a foreground start from the background (e.g. from a worker), as
            // ForegroundServiceStartNotAllowedException. The sync keeps running; the next time the app
            // is opened it reconciles again.
            Log.w(TAG, "service start refused: ${e.javaClass.name}")
        }
    }

    private fun stop(app: Context) {
        try {
            app.stopService(Intent(app, CoreService::class.java))
        } catch (e: Exception) {
            Log.w(TAG, "service stop failed: ${e.javaClass.name}")
        }
    }

    private fun scheduleResume(app: Context, at: Long?, now: Long) {
        try {
            val work = WorkManager.getInstance(app)
            if (at == null) {
                work.cancelUniqueWork(RESUME_WORK_NAME)
            } else {
                val request = OneTimeWorkRequestBuilder<ResumeWorker>()
                    .setInitialDelay(at - now, TimeUnit.MILLISECONDS)
                    .build()
                work.enqueueUniqueWork(RESUME_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Log.w(TAG, "resume work failed: ${e.javaClass.name}")
        }
    }
}
