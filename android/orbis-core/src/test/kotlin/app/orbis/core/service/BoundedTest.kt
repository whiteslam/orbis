package app.orbis.core.service

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** BootReceiver's goAsync must always finish within the broadcast limit, whatever reconcile does. */
class BoundedTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @After fun tearDown() = scope.cancel()

    @Test
    fun blockingWorkPastTheLimitStillCallsOnDoneInTime() {
        val done = CountDownLatch(1)
        val finished = AtomicBoolean(false)
        val timedOut = AtomicBoolean(false)
        val started = System.nanoTime()
        // A store call stuck in the keystore: blocking, so cancellation can't stop it.
        launchBounded(
            scope,
            timeoutMs = 100,
            work = { Thread.sleep(3_000); finished.set(true) },
            onTimeout = { timedOut.set(true) },
            onDone = { done.countDown() },
        )
        assertTrue("onDone within the limit", done.await(1_500, TimeUnit.MILLISECONDS))
        assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 1_500)
        assertFalse(finished.get())
        assertTrue(timedOut.get())
    }

    @Test
    fun quickWorkFinishesBeforeOnDone() {
        val done = CountDownLatch(1)
        val order = mutableListOf<String>()
        val timedOut = AtomicBoolean(false)
        launchBounded(
            scope,
            timeoutMs = 5_000,
            work = { synchronized(order) { order += "work" } },
            onTimeout = { timedOut.set(true) },
            onDone = { synchronized(order) { order += "done" }; done.countDown() },
        )
        assertTrue(done.await(2, TimeUnit.SECONDS))
        assertEquals(listOf("work", "done"), synchronized(order) { order.toList() })
        assertFalse(timedOut.get())
    }

    @Test
    fun failingWorkStillCallsOnDoneOnce() {
        val done = CountDownLatch(1)
        val calls = AtomicInteger(0)
        launchBounded(
            scope,
            timeoutMs = 5_000,
            work = { throw IllegalStateException("store broke") },
            onDone = { calls.incrementAndGet(); done.countDown() },
        )
        assertTrue(done.await(2, TimeUnit.SECONDS))
        Thread.sleep(100)
        assertEquals(1, calls.get())
    }

    @Test
    fun noLimitWaitsForTheWork() {
        val done = CountDownLatch(1)
        val finished = AtomicBoolean(false)
        launchBounded(
            scope,
            timeoutMs = null,
            work = { Thread.sleep(200); finished.set(true) },
            onDone = { done.countDown() },
        )
        assertTrue(done.await(2, TimeUnit.SECONDS))
        assertTrue(finished.get())
    }
}
