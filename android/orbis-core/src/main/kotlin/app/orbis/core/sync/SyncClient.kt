package app.orbis.core.sync

import app.orbis.core.store.DeviceCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
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
            val status = conn.responseCode
            // Read the answer out so the connection closes cleanly; its content isn't needed.
            (if (status >= 400) conn.errorStream else conn.inputStream)?.use { it.readBytes() }
            status
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        const val PATH = "/api/device/signals"
        const val TIMEOUT_MS = 15_000
    }
}
