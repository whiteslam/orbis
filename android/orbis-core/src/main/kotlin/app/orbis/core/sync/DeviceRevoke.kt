package app.orbis.core.sync

import app.orbis.core.store.DeviceCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/** Tells the server this phone is signing out (`POST /api/device/revoke` with its own credential). */
object DeviceRevoke {
    const val PATH = "/api/device/revoke"
    const val TIMEOUT_MS = 5_000

    /**
     * Best effort: the HTTP status, or null when there was no answer (no network, timeout, a bad
     * URL). Never throws, except cancellation. 204 means revoked; the caller wipes the phone either way.
     */
    suspend fun post(credential: DeviceCredential, timeoutMs: Int = TIMEOUT_MS): Int? = withContext(Dispatchers.IO) {
        try {
            val conn = URL(credential.serverUrl.trimEnd('/') + PATH).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = timeoutMs
                conn.readTimeout = timeoutMs
                // A redirect would resend the Authorization header somewhere else.
                conn.instanceFollowRedirects = false
                conn.doOutput = true
                conn.setRequestProperty("Authorization", "Device ${credential.deviceId}.${credential.secret}")
                conn.setFixedLengthStreamingMode(0)
                conn.outputStream.close()
                HttpSyncClient.statusFrom { conn.responseCode }
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            null
        }
    }
}
