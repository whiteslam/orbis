package app.orbis.core.sync

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.orbis.core.store.OrbisStore

/** Sends the outbox, sources, ledger and meta to the server. See [SyncRunner] for the rules. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val runner = SyncRunner(
            store = OrbisSyncStore(OrbisStore.get(context)),
            client = HttpSyncClient(),
            appVersion = appVersion(context),
            onRevoked = { CoreHooks.onRevoked(context) },
            log = { Log.i(TAG, it) },
        )
        return when (runner.run()) {
            SyncRunner.Result.Success -> Result.success()
            SyncRunner.Result.Retry -> Result.retry()
        }
    }

    private fun appVersion(context: Context): String? = try {
        // orbis-core can't read :app's BuildConfig, so ask the package manager for the host app's versionName.
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0).versionName?.take(MAX_VERSION_CHARS)
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }

    companion object {
        private const val TAG = "OrbisSync"

        /** The server refuses an appVersion over 20 characters. */
        private const val MAX_VERSION_CHARS = 20
    }
}
