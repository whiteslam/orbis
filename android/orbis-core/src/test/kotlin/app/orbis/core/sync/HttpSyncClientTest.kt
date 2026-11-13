package app.orbis.core.sync

import app.orbis.core.store.DeviceCredential
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * HttpSyncClient against a real local server: a bare socket that reads one request and answers with
 * a fixed status and no WWW-Authenticate header, like the real server's 401. (com.sun.net.httpserver
 * is not visible to the Kotlin compiler here.)
 */
class HttpSyncClientTest {
    private lateinit var server: ServerSocket
    private var status = 200
    private var challenge = false
    private var lastRequestHead = ""
    private var lastBody = ""

    @Before
    fun start() {
        server = ServerSocket(0, 5, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: Exception) { return@thread }
                try { serve(socket) } catch (_: Exception) {} finally { socket.close() }
            }
        }
    }

    @After
    fun stop() = server.close()

    private fun serve(socket: Socket) {
        val input = socket.getInputStream()
        val head = ByteArrayOutputStream()
        // Read up to the blank line that ends the headers.
        while (!head.toString(Charsets.ISO_8859_1).endsWith("\r\n\r\n")) {
            val b = input.read()
            if (b < 0) return
            head.write(b)
        }
        val headText = head.toString(Charsets.ISO_8859_1)
        val length = Regex("(?i)content-length: *([0-9]+)").find(headText)?.groupValues?.get(1)?.toInt() ?: 0
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        lastRequestHead = headText
        lastBody = body.toString(Charsets.UTF_8)
        val reason = when (status) { 200 -> "OK"; 401 -> "Unauthorized"; else -> "Error" }
        socket.getOutputStream().apply {
            val extra = if (challenge) "WWW-Authenticate: Basic realm=x\r\n" else ""
            write("HTTP/1.1 $status $reason\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            flush()
        }
    }

    private fun post(body: String = "{\"signals\":[]}"): Int {
        val cred = DeviceCredential("dev-1", "s3cret", "user-1", "http://127.0.0.1:${server.localPort}/")
        return runBlocking { HttpSyncClient().post(cred, body) }
    }

    @Test
    fun a401WithNoChallengeHeaderReachesTheCallerAs401() {
        status = 401
        assertEquals(401, post())
    }

    // With a challenge header, the JDK refuses to retry a streamed POST and throws HttpRetryException.
    @Test
    fun a401WithAChallengeHeaderStillReachesTheCallerAs401() {
        status = 401
        challenge = true
        assertEquals(401, post())
    }

    @Test
    fun a200IsReturned() {
        status = 200
        assertEquals(200, post())
    }

    @Test
    fun a503IsReturned() {
        status = 503
        assertEquals(503, post())
    }

    @Test
    fun a401ThatReachesTheRunnerMapsToRevoked() {
        status = 401
        assertEquals(SyncOutcome.Revoked, SyncOutcome.from(post()))
    }

    @Test
    fun itPostsTheBodyToTheSignalsPathWithTheDeviceHeader() {
        status = 200
        post("{\"hello\":\"caf\u00E9\"}")
        assertEquals(true, lastRequestHead.startsWith("POST /api/device/signals HTTP/1.1")) // no doubled slash
        assertEquals(true, lastRequestHead.contains("Authorization: Device dev-1.s3cret"))
        assertEquals("{\"hello\":\"caf\u00E9\"}", lastBody)
    }

    // The JDK stub does not throw from responseCode (checked: with and without a WWW-Authenticate header
    // the tests above pass even without this handling), so the exception paths are driven directly.
    @Test
    fun anHttpRetryExceptionYieldsItsStatus() {
        val read = { throw java.net.HttpRetryException("cannot retry due to server authentication, in streaming mode", 401) }
        assertEquals(401, HttpSyncClient.statusFrom(read))
    }

    @Test
    fun anAuthChallengeIoExceptionFallsBackToAskingAgain() {
        var calls = 0
        val status = HttpSyncClient.statusFrom {
            if (calls++ == 0) throw java.io.IOException("No authentication challenges found") else 401
        }
        assertEquals(401, status)
        assertEquals(2, calls)
    }

    @Test
    fun theFallbackItselfMayThrowAnHttpRetryException() {
        var calls = 0
        val status = HttpSyncClient.statusFrom {
            if (calls++ == 0) throw java.io.IOException("No authentication challenges found")
            else throw java.net.HttpRetryException("streaming", 401)
        }
        assertEquals(401, status)
    }

    @Test
    fun anyOtherIoExceptionStillPropagates() {
        try {
            HttpSyncClient.statusFrom { throw java.io.IOException("Connection reset") }
            org.junit.Assert.fail("expected an IOException")
        } catch (e: java.io.IOException) {
            assertEquals("Connection reset", e.message)
        }
    }
}
