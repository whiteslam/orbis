package app.orbis.core.sync

import app.orbis.core.store.DeviceCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpRetryException
import java.net.HttpURLConnection
import java.net.URL

/** Posts one sync body and returns the HTTP status. Throws [IOException] when there is no answer. */
fun interface SyncClient {
    suspend fun post(credential: DeviceCredential, body: String): Int
}

/** [SyncClient] over [HttpURLConnection], with 15 s timeouts. */
class HttpSyncClient : SyncClient {
    override suspend fun post(credential: DeviceCredential, body: String): Int = withContext(Dispatchers.IO) {
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
            // Read the answer out so the connection closes cleanly; its content isn't needed, and the
            // status is already known, so a failure here changes nothing.
            try {
                (if (status >= 400) conn.errorStream else conn.inputStream)?.use { it.readBytes() }
            } catch (_: IOException) {
            }
            status
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

        const val PATH = "/api/device/signals"
        const val TIMEOUT_MS = 15_000
    }
}
