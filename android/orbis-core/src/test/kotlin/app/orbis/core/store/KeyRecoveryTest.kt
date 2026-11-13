package app.orbis.core.store

import android.security.keystore.KeyPermanentlyInvalidatedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyStoreException
import java.security.ProviderException
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException

class KeyRecoveryTest {
    private class MemoryClock : FailureClock {
        var first: Long? = null
        var writes = 0
        override fun firstFailureAt() = first
        override fun setFirstFailureAt(at: Long) { first = at; writes++ }
        override fun clearFirstFailure() { first = null; writes++ }
    }

    private val hour = 60L * 60 * 1000

    @Test
    fun definitiveFailuresMeanTheKeyIsGone() {
        assertTrue(KeyRecovery.isKeyGone(KeyGoneException("alias missing")))
        assertTrue(KeyRecovery.isKeyGone(AEADBadTagException("tag")))
        assertTrue(KeyRecovery.isKeyGone(KeyPermanentlyInvalidatedException()))
        // Wrapped somewhere in the cause chain still counts.
        assertTrue(KeyRecovery.isKeyGone(RuntimeException("outer", AEADBadTagException("tag"))))
        assertTrue(KeyRecovery.isKeyGone(IllegalStateException(KeyGoneException("short blob"))))
    }

    @Test
    fun transientFailuresAreNotGone() {
        assertFalse(KeyRecovery.isKeyGone(KeyStoreException("keystore2 busy")))
        assertFalse(KeyRecovery.isKeyGone(ProviderException("Keystore operation failed")))
        assertFalse(KeyRecovery.isKeyGone(UnrecoverableKeyException("try again")))
        assertFalse(KeyRecovery.isKeyGone(IllegalStateException("anything else")))
        assertFalse(KeyRecovery.isKeyGone(RuntimeException(ProviderException("restarting"))))
    }

    @Test
    fun aGoneKeyResetsAtOnceWithoutTouchingTheFailureClock() {
        val failures = MemoryClock()
        val recovery = KeyRecovery(failures) { 1_000L }
        assertTrue(recovery.shouldReset(AEADBadTagException("tag")))
        assertNull(failures.first)
    }

    @Test
    fun transientFailuresRethrowUntilTheyHaveLastedMoreThan24Hours() {
        val failures = MemoryClock()
        var now = 10_000_000L
        val recovery = KeyRecovery(failures) { now }
        val busy = ProviderException("busy")

        assertFalse(recovery.shouldReset(busy))
        assertEquals(10_000_000L, failures.first)

        now += 23 * hour
        assertFalse(recovery.shouldReset(busy))
        assertEquals("the first failure time is kept", 10_000_000L, failures.first)

        now = 10_000_000L + KeyRecovery.WEDGE_MS
        assertFalse("exactly 24 h is not yet more than 24 h", recovery.shouldReset(busy))

        now += 1
        assertTrue(recovery.shouldReset(busy))
    }

    @Test
    fun aSuccessClearsTheFailureClock() {
        val failures = MemoryClock()
        var now = 0L
        val recovery = KeyRecovery(failures) { now }
        assertFalse(recovery.shouldReset(KeyStoreException("busy")))
        recovery.onSuccess()
        assertNull(failures.first)

        // A new streak starts from its own first failure.
        now = 30 * hour
        assertFalse(recovery.shouldReset(KeyStoreException("busy")))
        now += 2 * hour
        assertFalse(recovery.shouldReset(KeyStoreException("busy")))
    }

    @Test
    fun aSuccessWithNoFailureRecordedWritesNothing() {
        val failures = MemoryClock()
        KeyRecovery(failures) { 0L }.onSuccess()
        assertEquals(0, failures.writes)
    }

    @Test
    fun aFirstFailureInTheFutureRestartsTheStreak() {
        val failures = MemoryClock()
        failures.first = 100 * hour // the clock went backwards since
        val recovery = KeyRecovery(failures) { 1 * hour }
        assertFalse(recovery.shouldReset(KeyStoreException("busy")))
        assertEquals(1 * hour, failures.first)
    }
}
