package app.orbis.core.service

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Runs [work] in [scope] and calls [onDone] once, when the work ends or after [timeoutMs], whichever
 * comes first (no limit when [timeoutMs] is null). On a timeout the work is left running, not
 * cancelled: a blocking store or keystore call can't be interrupted anyway, and the caller (a
 * receiver's goAsync) only needs to be released in time. [onTimeout] runs just before [onDone] then.
 * A failing [work] is swallowed (the work logs its own failures); it never reaches the scope.
 */
internal fun launchBounded(
    scope: CoroutineScope,
    timeoutMs: Long?,
    work: suspend () -> Unit,
    onTimeout: () -> Unit = {},
    onDone: () -> Unit,
): Job = scope.launch {
    try {
        val job = scope.launch {
            try {
                work()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
        }
        if (timeoutMs == null) {
            job.join()
        } else if (withTimeoutOrNull(timeoutMs) { job.join() } == null) {
            onTimeout()
        }
    } finally {
        onDone()
    }
}
