package app.orbis.core.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orbis.core.store.DeviceCredential
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * HttpSyncClient and DeviceRevoke on Android's own HttpURLConnection (the JVM tests use the JDK's, which
 * behaves differently on a 401 with no WWW-Authenticate header). A bare socket on 127.0.0.1 inside the
 * emulator answers each request with a fixed status and no challenge, like the real server's 401.
 */
@RunWith(AndroidJUnit4::class)
class HttpOnDeviceTest {
    private lateinit var server: ServerSocket
    @Volatile private var status = 200
    @Volatile private var lastRequestHead = ""

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
        while (!head.toString("ISO-8859-1").endsWith("\r\n\r\n")) {
            val b = input.read()
            if (b < 0) return
            head.write(b)
        }
        val headText = head.toString("ISO-8859-1")
        val length = Regex("(?i)content-length: *([0-9]+)").find(headText)?.groupValues?.get(1)?.toInt() ?: 0
        var left = length
        val buffer = ByteArray(4096)
        while (left > 0) {
            val n = input.read(buffer, 0, minOf(left, buffer.size))
            if (n < 0) break
            left -= n
        }
        lastRequestHead = headText
        val reason = when (status) { 200 -> "OK"; 204 -> "No Content"; 401 -> "Unauthorized"; else -> "Error" }
        val body = if (status == 204) "" else "{\"error\":\"x\"}"
        socket.getOutputStream().apply {
            write("HTTP/1.1 $status $reason\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body".toByteArray())
            flush()
        }
    }

    private val credential get() =
        DeviceCredential("0b6f5c1e-2f43-4a51-9d1e-6c1f3e2a9b70", "s".repeat(43), "u-1", "http://127.0.0.1:${server.localPort}")

    private fun sync(): Int = runBlocking { HttpSyncClient().post(credential, "{\"signals\":[]}").status }

    @Test
    fun a401WithNoChallengeHeaderIs401() {
        status = 401
        assertEquals(401, sync())
        assertEquals(SyncOutcome.Revoked, SyncOutcome.from(401, null))
    }

    @Test
    fun a200Is200() {
        status = 200
        assertEquals(200, sync())
        assertTrue(lastRequestHead.startsWith("POST /api/device/signals HTTP/1.1"))
        assertTrue(lastRequestHead.contains("Authorization: Device ${credential.deviceId}.${credential.secret}"))
    }

    @Test
    fun a503Is503() {
        status = 503
        assertEquals(503, sync())
    }

    @Test
    fun revokePostsWithTheDeviceHeader() {
        status = 204
        assertEquals(204, runBlocking { DeviceRevoke.post(credential) })
        assertTrue(lastRequestHead.startsWith("POST /api/device/revoke HTTP/1.1"))
        assertTrue(lastRequestHead.contains("Authorization: Device ${credential.deviceId}.${credential.secret}"))
    }

    @Test
    fun revokeAnswers401AsAStatusNotAnError() {
        status = 401
        assertEquals(401, runBlocking { DeviceRevoke.post(credential) })
    }

    @Test
    fun revokeWithNoServerIsNullNotAnException() {
        val port = server.localPort
        server.close()
        val gone = credential.copy(serverUrl = "http://127.0.0.1:$port")
        assertNull(runBlocking { DeviceRevoke.post(gone, timeoutMs = 2_000) })
    }
}
