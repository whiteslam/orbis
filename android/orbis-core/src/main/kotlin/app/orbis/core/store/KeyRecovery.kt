package app.orbis.core.store

import android.security.keystore.KeyPermanentlyInvalidatedException
import javax.crypto.AEADBadTagException

/** The saved database key can never be recovered: missing, malformed or the wrong length. */
internal class KeyGoneException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Where [KeyRecovery] keeps the time of the first unwrap failure that wasn't definitive. */
internal interface FailureClock {
    fun firstFailureAt(): Long?
    fun setFirstFailureAt(at: Long)
    fun clearFirstFailure()
}

/**
 * Decides whether an unwrap failure means the store must start fresh (ruling R18).
 *
 * Only a key that is definitively gone resets the store. Anything else (a busy or restarting
 * keystore) is rethrown so the caller retries later, unless such failures have gone on for
 * more than [WEDGE_MS], so a truly broken keystore can't stall the phone for ever.
 */
internal class KeyRecovery(private val failures: FailureClock, private val clock: () -> Long) {
    fun onSuccess() {
        if (failures.firstFailureAt() != null) failures.clearFirstFailure()
    }

    /** True: reset the store. False: rethrow [t] and retry later. */
    fun shouldReset(t: Throwable): Boolean {
        if (isKeyGone(t)) return true
        val now = clock()
        val first = failures.firstFailureAt()
        if (first == null || first > now) {
            failures.setFirstFailureAt(now)
            return false
        }
        return now - first > WEDGE_MS
    }

    companion object {
        const val WEDGE_MS = 24L * 60 * 60 * 1000

        /** True when [t], or one of its causes, shows the saved key can never be unwrapped. */
        fun isKeyGone(t: Throwable): Boolean =
            generateSequence(t) { it.cause }.take(10).any {
                it is KeyGoneException || it is AEADBadTagException || it is KeyPermanentlyInvalidatedException
            }
    }
}
