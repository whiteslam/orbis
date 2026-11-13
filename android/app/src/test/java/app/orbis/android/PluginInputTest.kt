package app.orbis.android

import app.orbis.core.rules.PAUSED_FOREVER
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PluginInputTest {
    private val server = "https://orbis-starter.vercel.app"

    private fun rejects(code: String, block: () -> Unit) {
        try {
            block()
            fail("expected $code")
        } catch (e: Rejection) {
            assertEquals(code, e.code)
        }
    }

    @Test
    fun sameOriginAcceptsOnlyTheServer() {
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app/", server))
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app/settings?x=1#y", server))
        assertTrue(PluginInput.sameOrigin("https://ORBIS-starter.vercel.app:443/a", server))
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app/", "$server/"))

        assertFalse(PluginInput.sameOrigin("https://example.com/", server))
        assertFalse(PluginInput.sameOrigin("http://example.com/", server))
        assertFalse(PluginInput.sameOrigin("http://orbis-starter.vercel.app/", server))
        assertFalse(PluginInput.sameOrigin("https://orbis-starter.vercel.app:8443/", server))
        assertFalse(PluginInput.sameOrigin("https://orbis-starter.vercel.app.evil.com/", server))
        assertFalse(PluginInput.sameOrigin("https://evil.com/orbis-starter.vercel.app", server))
        assertFalse(PluginInput.sameOrigin("https://orbis-starter.vercel.app@evil.com/", server))
        assertFalse(PluginInput.sameOrigin("https://localhost/offline.html", server))
        assertFalse(PluginInput.sameOrigin("about:blank", server))
        assertFalse(PluginInput.sameOrigin("file:///android_asset/index.html", server))
        assertFalse(PluginInput.sameOrigin("not a url", server))
        assertFalse(PluginInput.sameOrigin(null, server))
        assertFalse(PluginInput.sameOrigin("https://orbis-starter.vercel.app/", null))
        assertFalse(PluginInput.sameOrigin("", ""))
    }

    @Test
    fun sameOriginLooksOnlyAtSchemeAndAuthority() {
        // Characters java.net.URI refuses in a path or query don't make the page foreign.
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app/search?q=a|b{c}", server))
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app/a b/%zz^`", server))
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app?q=1", server))
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app#top", server))
        assertTrue(PluginInput.sameOrigin("HTTPS://orbis-starter.vercel.app.:443/x", server))
        assertTrue(PluginInput.sameOrigin("https://orbis-starter.vercel.app:/x", server))
        assertTrue(PluginInput.sameOrigin("http://10.0.2.2:3000/active", "http://10.0.2.2:3000"))
        assertTrue(PluginInput.sameOrigin("http://[::1]:3000/", "http://[::1]:3000"))

        assertFalse(PluginInput.sameOrigin("https://orbis-starter.vercel.app?@evil.com", "https://evil.com"))
        assertFalse(PluginInput.sameOrigin("https://evil.com\\@orbis-starter.vercel.app/", server))
        assertFalse(PluginInput.sameOrigin("https://evil.com#@orbis-starter.vercel.app/", server))
        assertFalse(PluginInput.sameOrigin("https://orbis-starter.vercel.app:99999/", server))
        assertFalse(PluginInput.sameOrigin("https://orbis-starter.vercel.app:44a/", server))
        assertFalse(PluginInput.sameOrigin("https:///orbis-starter.vercel.app/", server))
        assertFalse(PluginInput.sameOrigin("https:orbis-starter.vercel.app", server))
        assertFalse(PluginInput.sameOrigin("javascript://orbis-starter.vercel.app/%0aalert(1)", server))
        assertFalse(PluginInput.sameOrigin("https://orbis starter.vercel.app/", server))
        assertFalse(PluginInput.sameOrigin("http://10.0.2.2:3001/", "http://10.0.2.2:3000"))
    }

    @Test
    fun credentialShape() {
        val id = "0b6f5c1e-2f43-4a51-9d1e-6c1f3e2a9b70"
        val secret = "A".repeat(42) + "_"
        assertTrue(PluginInput.validCredential(id, secret, id))
        assertFalse(PluginInput.validCredential(id, secret.dropLast(1), id))
        assertFalse(PluginInput.validCredential(id, "$secret=", id))
        assertFalse(PluginInput.validCredential(id, secret.dropLast(1) + "+", id))
        assertFalse(PluginInput.validCredential("not-a-uuid", secret, id))
        assertFalse(PluginInput.validCredential(id, secret, 42))
        assertFalse(PluginInput.validCredential(null, secret, id))
    }

    @Test
    fun pauseValues() {
        assertNull(PluginInput.pausedUntil(0))
        assertEquals(PAUSED_FOREVER, PluginInput.pausedUntil(-1))
        assertEquals(1_800_000_000_000L, PluginInput.pausedUntil(1_800_000_000_000L))
        assertEquals(1_800_000_000_000L, PluginInput.pausedUntil(1.8e12))
        rejects(PluginInput.INVALID_UNTIL) { PluginInput.pausedUntil(-2) }
        rejects(PluginInput.INVALID_UNTIL) { PluginInput.pausedUntil(1.5) }
        rejects(PluginInput.INVALID_UNTIL) { PluginInput.pausedUntil("0") }
        rejects(PluginInput.INVALID_UNTIL) { PluginInput.pausedUntil(null) }
        rejects(PluginInput.INVALID_UNTIL) { PluginInput.pausedUntil(Double.NaN) }
        rejects(PluginInput.INVALID_UNTIL) { PluginInput.pausedUntil(Long.MAX_VALUE) }
    }

    @Test
    fun pausedForeverIsMinusOneForThePage() {
        assertEquals(-1L, PluginInput.pausedUntilForPage(PAUSED_FOREVER))
        assertNull(PluginInput.pausedUntilForPage(null))
        assertEquals(123L, PluginInput.pausedUntilForPage(123L))
    }

    @Test
    fun activityLimit() {
        assertEquals(PluginInput.DEFAULT_ACTIVITY_LIMIT, PluginInput.activityLimit(null))
        assertEquals(1, PluginInput.activityLimit(1))
        assertEquals(500, PluginInput.activityLimit(500))
        rejects(PluginInput.INVALID_LIMIT) { PluginInput.activityLimit(0) }
        rejects(PluginInput.INVALID_LIMIT) { PluginInput.activityLimit(501) }
        rejects(PluginInput.INVALID_LIMIT) { PluginInput.activityLimit("10") }
    }

    @Test
    fun listsAreTrimmedDeduplicatedAndBounded() {
        assertNull(PluginInput.list(null))
        assertEquals(listOf("a", "b"), PluginInput.list(listOf(" a ", "", "  ", "b", "a")))
        rejects(PluginInput.INVALID_PRIVACY) { PluginInput.list(listOf("a", 1)) }
        rejects(PluginInput.INVALID_PRIVACY) { PluginInput.list(listOf<Any?>(null)) }
        rejects(PluginInput.INVALID_PRIVACY) { PluginInput.list(listOf("x".repeat(201))) }
        rejects(PluginInput.INVALID_PRIVACY) { PluginInput.list(List(501) { "p$it" }) }
    }

    @Test
    fun contactsAreStoredAsKeys() {
        assertEquals(
            setOf("9876543210", "mom"),
            PluginInput.contactKeys(listOf("+91 98765-43210", "9876543210", "  Mom ", " ")),
        )
    }

    @Test
    fun testCaptureAndTokenInputs() {
        assertEquals("Your OTP is 123456", PluginInput.testText("Your OTP is 123456"))
        rejects(PluginInput.INVALID_TEXT) { PluginInput.testText(null) }
        rejects(PluginInput.INVALID_TEXT) { PluginInput.testText("x".repeat(10_001)) }
        assertNull(PluginInput.optionalShort(null))
        assertNull(PluginInput.optionalShort("  "))
        assertEquals("com.authy.authy", PluginInput.optionalShort(" com.authy.authy "))
        rejects(PluginInput.INVALID_TEXT) { PluginInput.optionalShort(5) }
        assertEquals("tok", PluginInput.pushToken("tok"))
        rejects(PluginInput.INVALID_TOKEN) { PluginInput.pushToken(" ") }
        rejects(PluginInput.INVALID_TOKEN) { PluginInput.pushToken("t".repeat(4097)) }
    }
}
