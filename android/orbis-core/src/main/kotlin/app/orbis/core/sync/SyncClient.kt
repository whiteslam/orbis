package app.orbis.core.sync

import app.orbis.core.store.DeviceCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpRetryException
import java.net.HttpURLConnection
import java.net.URL

/**
 * One sync answer: the HTTP [status] and the answer's [body] as text, or null when there was none or it
 * could not be read (or was larger than [HttpSyncClient.MAX_REPLY_BYTES]). [SyncOutcome.from] needs both:
 * a 2xx counts only with the server's JSON counts in the body (R20).
 */
data class SyncReply(val status: Int, val body: String?)

/** Posts one sync body and returns the answer. Throws [IOException] when there is no answer. */
fun interface SyncClient {
    suspend fun post(credential: DeviceCredential, body: String): SyncReply
}

/**
 * [SyncClient] over [HttpURLConnection], with 15 s timeouts.
 *
 * The WebView's cookies may ride along: Capacitor's cookie handler is installed process-wide
 * (CookieHandler.setDefault), and HttpURLConnection has no per-request way around it (swapping the
 * global handler around a request isn't thread-safe). The server ignores them on this route: proxy.ts
 * passes `/api/device/signals` through before its session refresh (lib/device/session-free.ts), so a
 * background sync never rotates the person's session, and the route reads only the device credential.
 */
class HttpSyncClient : SyncClient {
    override suspend fun post(credential: DeviceCredential, body: String): SyncReply = withContext(Dispatchers.IO) {
        val url = URL(credential.serverUrl.trimEnd('/') + PATH)
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            // A redirect would resend the Authorization header somewhere else, or turn the POST into a GET.
            conn.instanceFollowRedirects = false
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Authorization", "Device ${credential.deviceId}.${credential.secret}")
            val bytes = body.toByteArray(Charsets.UTF_8)
            conn.setFixedLengthStreamingMode(bytes.size)
            conn.outputStream.use { it.write(bytes) }
            val status = statusOf(conn)
            // The answer decides whether a 2xx counts (R20). The status is already known, so a failed
            // read only means "no body", which makes a 2xx a retry.
            val reply = try {
                (if (status >= 400) conn.errorStream else conn.inputStream)?.use { readCapped(it) }
            } catch (_: IOException) {
                null
            }
            SyncReply(status, reply)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * The HTTP status, even for a 401. The server's 401 carries no WWW-Authenticate header, and on a
     * streamed POST the JDK's HttpURLConnection (and some Android stacks) then throws instead of
     * returning it: [HttpRetryException] ("cannot retry due to server authentication, in streaming
     * mode") or an [IOException] ("No authentication challenges found"). Treating that as a network
     * error would make a revoked phone retry forever, so the status is recovered from the exception.
     */
    private fun statusOf(conn: HttpURLConnection): Int = statusFrom { conn.responseCode }

    companion object {
        /** The status [read] returns, or the 401 an auth-related exception stands for. See [statusOf]. */
        internal fun statusFrom(read: () -> Int): Int = try {
            read()
        } catch (e: HttpRetryException) {
            e.responseCode()
        } catch (e: IOException) {
            // The JDK raises "No authentication challenges found" only while handling a 401 reply that
            // has no WWW-Authenticate header, which is how the server answers an unknown or revoked
            // phone. Asking again could throw the same thing, so the status is simply 401. The proxy
            // variant ("No proxy authentication challenges found", a 407) is a different problem and
            // stays an ordinary network error.
            if (isAuthChallenge(e)) 401 else throw e
        }

        private fun isAuthChallenge(e: IOException): Boolean {
            val message = e.message ?: return false
            return message.contains("authentication challenge", ignoreCase = true) &&
                !message.contains("proxy", ignoreCase = true)
        }

        /** Up to [MAX_REPLY_BYTES] of [input] as UTF-8, or null when it is longer (not the server's small JSON). */
        internal fun readCapped(input: java.io.InputStream): String? {
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
                if (out.size() > MAX_REPLY_BYTES) return null
            }
            return out.toString("UTF-8")
        }

        const val MAX_REPLY_BYTES = 16 * 1024
        const val PATH = "/api/device/signals"
        const val TIMEOUT_MS = 15_000
    }
}
