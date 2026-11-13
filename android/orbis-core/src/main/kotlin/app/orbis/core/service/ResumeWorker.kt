package app.orbis.core.service

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** Runs when a timed pause ends (`orbis-resume`): reconcile starts the service again. */
class ResumeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        CoreController.reconcile(applicationContext)
        return Result.success()
    }
}
