package app.orbis.core.notify

import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class NotificationIntakeTest {
    private val facts = NotificationFacts("k", "com.whatsapp", "Asha", "Hi", null, 1L, false, false, false)
    private val logged = mutableListOf<String>()
    private var captured = 0

    private fun intake(
        enabled: suspend () -> Boolean = { true },
        capture: suspend (CapturedItem) -> Decision = { captured++; Decision.Keep(it.text) },
    ) = NotificationIntake("app.orbis.android", RecentKeys(), enabled, capture, {}, { logged += it })

    @Test fun `a capture that throws is logged by class name and does not propagate`() = runBlocking {
        intake(capture = { throw IOException("secret notification text") }).handle(facts)
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

    @Test fun `cancellation is rethrown`() {
        var thrown = false
        try {
            runBlocking { intake(capture = { throw kotlin.coroutines.cancellation.CancellationException("c") }).handle(facts) }
        } catch (e: kotlin.coroutines.cancellation.CancellationException) { thrown = true }
        assertTrue(thrown)
        assertTrue(logged.isEmpty())
    }
}
