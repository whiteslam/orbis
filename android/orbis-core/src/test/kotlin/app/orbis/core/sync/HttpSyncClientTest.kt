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
    // Written by the test thread and read by the server thread, or the other way round.
    @Volatile private var status = 200
    @Volatile private var challenge = false
    @Volatile private var replyType = "application/json"
    @Volatile private var replyBody = ""
    @Volatile private var lastRequestHead = ""
    @Volatile private var lastBody = ""

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
            val bytes = replyBody.toByteArray(Charsets.UTF_8)
            write("HTTP/1.1 $status $reason\r\n${extra}Content-Type: $replyType\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(bytes)
            flush()
        }
    }

    private fun post(body: String = "{\"signals\":[]}"): Int = reply(body).status

    private fun reply(body: String = "{\"signals\":[]}"): SyncReply {
        val cred = DeviceCredential("dev-1", "s3cret", "user-1", "http://127.0.0.1:${server.localPort}/")
        return runBlocking { HttpSyncClient().post(cred, body) }
    }

    @Test
    fun a401WithNoChallengeHeaderReachesTheCallerAs401() {
        status = 401
        assertEquals(401, post())
    }

    // A 401 that does carry a challenge header (the real server's does not).
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
        assertEquals(SyncOutcome.Revoked, SyncOutcome.from(post(), null))
    }

    @Test
    fun itPostsTheBodyToTheSignalsPathWithTheDeviceHeader() {
        status = 200
        post("{\"hello\":\"caf\u00E9\"}")
        assertEquals(true, lastRequestHead.startsWith("POST /api/device/signals HTTP/1.1")) // no doubled slash
        assertEquals(true, lastRequestHead.contains("Authorization: Device dev-1.s3cret"))
        assertEquals("{\"hello\":\"caf\u00E9\"}", lastBody)
    }

    @Test
    fun a200WithTheServersCountsIsDone() {
        status = 200
        replyBody = "{\"accepted\":1,\"duplicate\":0,\"refused\":0}"
        val r = reply()
        assertEquals(200, r.status)
        assertEquals(replyBody, r.body)
        assertEquals(SyncOutcome.Done, SyncOutcome.from(r.status, r.body))
    }

    // R20: production answered the undeployed route with 200 text/html; that must not empty the outbox.
    @Test
    fun a200HtmlPageIsRetry() {
        status = 200
        replyType = "text/html; charset=utf-8"
        replyBody = "<!DOCTYPE html><html><head><title>Orbis</title></head><body>Hello</body></html>"
        val r = reply()
        assertEquals(200, r.status)
        assertEquals(SyncOutcome.Retry, SyncOutcome.from(r.status, r.body))
    }

    @Test
    fun a200WithAnEmptyBodyIsRetry() {
        status = 200
        val r = reply()
        assertEquals(SyncOutcome.Retry, SyncOutcome.from(r.status, r.body))
    }

    // The JDK stub does not throw from responseCode (checked: the tests above pass even without the
    // handling, with or without a WWW-Authenticate header), so the exception paths are driven directly.
    @Test
    fun anHttpRetryExceptionYieldsItsStatus() {
        val read = { throw java.net.HttpRetryException("cannot retry due to server authentication, in streaming mode", 401) }
        assertEquals(401, HttpSyncClient.statusFrom(read))
    }

    @Test
    fun anAuthChallengeIoExceptionMeans401WithoutAskingAgain() {
        var calls = 0
        val status = HttpSyncClient.statusFrom {
            calls++
            throw java.io.IOException("No authentication challenges found")
        }
        assertEquals(401, status)
        assertEquals(1, calls)
    }

    @Test
    fun aProxyAuthChallengeIsStillANetworkError() {
        try {
            HttpSyncClient.statusFrom { throw java.io.IOException("No proxy authentication challenges found") }
            org.junit.Assert.fail("expected an IOException")
        } catch (e: java.io.IOException) {
            assertEquals("No proxy authentication challenges found", e.message)
        }
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
