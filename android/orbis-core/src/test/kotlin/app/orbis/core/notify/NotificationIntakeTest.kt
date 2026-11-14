package app.orbis.core.notify

import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import app.orbis.core.rules.DropReason
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class NotificationIntakeTest {
    private val facts = NotificationFacts("k", "com.whatsapp", "Asha", "Hi", null, 1L, 1L, false, false, false)
    private val logged = mutableListOf<String>()
    private val digests = mutableListOf<String>()
    private var captured = 0
    private var synced = 0

    private fun intake(
        enabled: suspend () -> Boolean = { true },
        capture: suspend (CapturedItem, String) -> Decision? = { item, digest -> captured++; digests += digest; Decision.Keep(item.text) },
        recent: RecentKeys = RecentKeys(),
    ) = NotificationIntake("app.orbis.android", recent, enabled, capture, { synced++ }, { logged += it })

    @Test fun `a capture that throws is logged by class name and does not propagate`() = runBlocking {
        intake(capture = { _, _ -> throw IOException("secret notification text") }).handle(facts)
        assertEquals(listOf("capture failed: java.io.IOException"), logged)
        assertTrue(logged.none { it.contains("secret") })
    }

    @Test fun `a store that cannot be read does not propagate`() = runBlocking {
        intake(enabled = { throw IllegalStateException("keystore") }).handle(facts)
        assertEquals(listOf("capture failed: java.lang.IllegalStateException"), logged)
    }

    @Test fun `nothing is captured while the source is off`() = runBlocking {
        intake(enabled = { false }).handle(facts)
        assertEquals(0, captured)
        assertTrue(logged.isEmpty())
    }

    @Test fun `an enabled source captures once`() = runBlocking {
        val i = intake()
        i.handle(facts); i.handle(facts)
        assertEquals(1, captured)
    }

    @Test fun `the store is given the notification's digest`() = runBlocking {
        intake().handle(facts)
        assertEquals(listOf(NotificationReader.digest(facts)), digests)
    }

    // The store is the real guard across restarts; the memory is only a cheap first filter, and
    // it must not remember a notification whose capture failed.
    @Test fun `a failed capture is tried again when the notification is posted again`() = runBlocking {
        var calls = 0
        val i = intake(capture = { item, _ -> calls++; if (calls == 1) throw IOException("busy") else Decision.Keep(item.text) })
        i.handle(facts); i.handle(facts); i.handle(facts)
        assertEquals(2, calls)
    }

    @Test fun `a fresh intake (after a restart) asks the store again`() = runBlocking {
        intake().handle(facts)
        intake().handle(facts)
        assertEquals(2, captured)
    }

    @Test fun `a kept payment syncs now, one the store already had does not`() = runBlocking {
        val payment = facts.copy(packageName = "com.google.android.apps.messaging", title = "AX-HDFCBK", text = "Rs 500 debited from a/c XX12 to SWIGGY")
        intake().handle(payment)
        assertEquals(1, synced)
        intake(capture = { _, _ -> null }).handle(payment)
        assertEquals(1, synced)
        intake(capture = { _, _ -> Decision.Drop(DropReason.BLOCKED_CONTACT) }).handle(payment)
        assertEquals(1, synced)
        intake().handle(facts)
        assertEquals("a chat message does not sync now", 1, synced)
    }

    @Test fun `cancellation is rethrown`() {
        var thrown = false
        try {
            runBlocking { intake(capture = { _, _ -> throw kotlin.coroutines.cancellation.CancellationException("c") }).handle(facts) }
        } catch (e: kotlin.coroutines.cancellation.CancellationException) { thrown = true }
        assertTrue(thrown)
        assertTrue(logged.isEmpty())
    }

    @Test fun `a notification whose extras cannot be read is logged by class name and skipped`() {
        val facts = NotificationIntake.readSafely({ logged += it }) {
            throw IllegalStateException("secret notification text")
        }
        assertEquals(null, facts)
        assertEquals(listOf("read failed: java.lang.IllegalStateException"), logged)
        assertTrue(logged.none { it.contains("secret") })
    }

    @Test fun `a notification that reads cleanly is passed through`() {
        assertEquals(facts, NotificationIntake.readSafely({ logged += it }) { facts })
        assertTrue(logged.isEmpty())
    }
}
