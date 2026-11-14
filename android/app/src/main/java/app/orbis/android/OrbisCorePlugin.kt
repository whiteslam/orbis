package app.orbis.android

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.webkit.WebViewFeature
import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import app.orbis.core.rules.Source
import app.orbis.core.service.CoreController
import app.orbis.core.store.DeviceCredential
import app.orbis.core.store.OrbisStore
import app.orbis.core.sync.DeviceRevoke
import app.orbis.core.sync.SyncScheduler
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * The page's way into orbis-core (lib/native/orbis-core.ts is its TypeScript side).
 *
 * - Every method first checks that the WebView is on the configured server's origin; anything else
 *   (example.com after a link, the offline page) is refused with `not_orbis_origin`.
 * - On a WebView without WEB_MESSAGE_LISTENER, Capacitor falls back to a JavaScript interface that
 *   every frame can reach, third-party iframes included, so every method is refused with
 *   `unsupported_webview` there.
 * - The work runs on [Dispatchers.IO] in a scope that ends with the activity.
 * - A failure rejects with a short code ([PluginInput]); exception messages never reach the page,
 *   and logs carry only the method and the exception class.
 */
@CapacitorPlugin(name = "OrbisCore")
class OrbisCorePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun load() {
        CoreController.reconcileAsync(context)
    }

    // A timed pause that ended while the app was closed is picked up here: the resume worker can't
    // start a foreground service from the background on Android 12+.
    override fun handleOnResume() {
        CoreController.reconcileAsync(context)
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }

    // --- methods ----------------------------------------------------------------------------

    @PluginMethod
    fun status(call: PluginCall) = handle(call) { statusJson() }

    @PluginMethod
    fun setDevice(call: PluginCall) = handle(call) {
        val data = call.data
        val deviceId = data.opt("deviceId")
        val secret = data.opt("secret")
        val userId = data.opt("userId")
        if (!PluginInput.validCredential(deviceId, secret, userId)) throw Rejection(PluginInput.INVALID_CREDENTIAL)
        // The server is the app's own, from capacitor.config.json; never from the page.
        val serverUrl = bridge.serverUrl ?: throw Rejection(PluginInput.NOT_ORBIS_ORIGIN)
        val credential = DeviceCredential(
            deviceId = (deviceId as String).lowercase(),
            secret = secret as String,
            userId = (userId as String).lowercase(),
            serverUrl = serverUrl,
        )
        store { s ->
            val token = s.pushToken()
            // Another account's items must never be sent under this one: start clean.
            val previous = s.credential()
            if (previous != null && previous.userId != credential.userId) s.wipe()
            s.saveCredential(credential)
            s.kvPut(OrbisStore.SIGNED_OUT_REASON, null)
            // A wipe clears the push token; keep the one the phone already had.
            if (token != null) s.setPushToken(token)
        }
        CoreController.reconcile(context)
        SyncScheduler.now(context)
        null
    }

    @PluginMethod
    fun signOut(call: PluginCall) = handle(call) {
        val revoke = call.data.optBoolean("revoke", false)
        val credential = store { it.credential() }
        // Best effort: the phone signs out whatever the server says.
        if (revoke && credential != null) DeviceRevoke.post(credential)
        store { it.wipe() }
        CoreController.reconcile(context)
        null
    }

    @PluginMethod
    fun getPrivacy(call: PluginCall) = handle(call) {
        val settings = store { it.settings() }
        JSObject()
            .put("sources", sourcesJson(settings.enabled))
            .put("blockedPackages", JSONArray(settings.blockedPackages.sorted()))
            .put("blockedContacts", JSONArray(settings.blockedContacts.sorted()))
            .put("blockedKeywords", JSONArray(settings.blockedKeywords))
            .put("pausedUntil", nullable(PluginInput.pausedUntilForPage(settings.pausedUntil)))
    }

    @PluginMethod
    fun setPrivacy(call: PluginCall) = handle(call) {
        val packages = PluginInput.list(arrayOption(call, "blockedPackages"))
        val contacts = PluginInput.list(arrayOption(call, "blockedContacts"))?.let(PluginInput::contactKeys)
        val keywords = PluginInput.list(arrayOption(call, "blockedKeywords"))
        // One transaction, so a source toggle or pause racing this call is never lost.
        store { s ->
            s.updateSettings { current ->
                current.copy(
                    blockedPackages = packages?.toSet() ?: current.blockedPackages,
                    blockedContacts = contacts ?: current.blockedContacts,
                    blockedKeywords = keywords ?: current.blockedKeywords,
                )
            }
        }
        null
    }

    @PluginMethod
    fun setSource(call: PluginCall) = handle(call) {
        val source = (call.data.opt("source") as? String)?.let(Source::fromWire)
            ?: throw Rejection(PluginInput.INVALID_SOURCE)
        val enabled = call.data.opt("enabled") as? Boolean ?: throw Rejection(PluginInput.INVALID_SOURCE)
        store { it.setSourceEnabled(source, enabled) }
        CoreController.reconcile(context)
        syncIfRegistered()
        statusJson()
    }

    @PluginMethod
    fun pause(call: PluginCall) = handle(call) {
        val until = PluginInput.pausedUntil(call.data.opt("until"))
        store { it.pause(until) }
        CoreController.reconcile(context)
        statusJson()
    }

    @PluginMethod
    fun testCapture(call: PluginCall) = handle(call) {
        val text = PluginInput.testText(call.data.opt("text"))
        val app = PluginInput.optionalShort(call.data.opt("app"))
        val contact = PluginInput.optionalShort(call.data.opt("contact"))
        val now = System.currentTimeMillis()
        val item = CapturedItem(
            source = Source.TEST,
            packageName = app,
            contacts = listOfNotNull(contact),
            text = text,
            occurredAt = now,
        )
        val decision = store { it.capture(item, now) }
        SyncScheduler.now(context)
        // Never the raw text: only the decision, and the masked text that was kept.
        when (decision) {
            is Decision.Keep -> JSObject().put("decision", "kept").put("masked", decision.maskedText)
            is Decision.Drop -> JSObject().put("decision", "dropped").put("reason", decision.reason.name)
        }
    }

    @PluginMethod
    fun listApps(call: PluginCall) = handle(call) {
        val pm = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        // Visible through the launcher <queries> entry in the manifest; no all-packages permission.
        val found = if (Build.VERSION.SDK_INT >= 33) {
            pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(launcher, 0)
        }
        val apps = found
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != context.packageName }
            .distinctBy { it.first }
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.second })
        val array = JSArray()
        apps.forEach { (pkg, label) -> array.put(JSObject().put("packageName", pkg).put("label", label)) }
        JSObject().put("apps", array)
    }

    @PluginMethod
    fun recentActivity(call: PluginCall) = handle(call) {
        val limit = PluginInput.activityLimit(call.data.opt("limit"))
        val entries = store { it.recentActivity(limit) }
        val array = JSArray()
        // Time, source, decision and reason only.
        entries.forEach { e ->
            val row = JSObject().put("at", e.at).put("source", e.source.wire).put("decision", e.decision)
            if (e.reason != null) row.put("reason", e.reason)
            array.put(row)
        }
        JSObject().put("entries", array)
    }

    @PluginMethod
    fun setPushToken(call: PluginCall) = handle(call) {
        val token = PluginInput.pushToken(call.data.opt("token"))
        store { it.setPushToken(token) }
        syncIfRegistered()
        null
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) = handle(call) {
        withContext(Dispatchers.Main) {
            val activity = activity ?: throw Rejection(PluginInput.NO_ACTIVITY)
            CoreController.openBatterySettings(activity, direct = BuildConfig.DISTRIBUTION == "direct")
        }
        null
    }

    @PluginMethod
    fun openAppInfo(call: PluginCall) = handle(call) {
        withContext(Dispatchers.Main) {
            val activity = activity ?: throw Rejection(PluginInput.NO_ACTIVITY)
            CoreController.openAppInfo(activity)
        }
        null
    }

    /** Whether Android has given Orbis notification access (the listener only runs once it has). */
    @PluginMethod
    fun notificationAccess(call: PluginCall) = handle(call) {
        val granted = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        JSObject().put("granted", granted)
    }

    @PluginMethod
    fun openNotificationAccess(call: PluginCall) = handle(call) {
        withContext(Dispatchers.Main) {
            val activity = activity ?: throw Rejection(PluginInput.NO_ACTIVITY)
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                activity.startActivity(intent)
            } catch (_: ActivityNotFoundException) {
                throw Rejection(PluginInput.FAILED)
            }
        }
        null
    }

    // --- helpers ----------------------------------------------------------------------------

    /**
     * Runs [block] off the main thread after the origin check, and resolves with what it returns
     * (null resolves with nothing). A [Rejection] rejects with its code; anything else with `failed`.
     */
    private fun handle(call: PluginCall, block: suspend () -> JSObject?) {
        scope.launch {
            try {
                if (!webViewSafe) throw Rejection(PluginInput.UNSUPPORTED_WEBVIEW)
                if (!fromOrbis()) throw Rejection(PluginInput.NOT_ORBIS_ORIGIN)
                val result = block()
                if (result == null) call.resolve() else call.resolve(result)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Rejection) {
                if (e.code == PluginInput.NOT_ORBIS_ORIGIN) Log.w(TAG, "${call.methodName}: refused, not the Orbis origin")
                if (e.code == PluginInput.UNSUPPORTED_WEBVIEW) Log.w(TAG, "${call.methodName}: refused, WebView too old")
                call.reject(e.code, e.code)
            } catch (e: Throwable) {
                // Errors too (e.g. UnsatisfiedLinkError when SQLCipher's native library can't load):
                // the call is rejected with a code instead of taking the app down. Class name only.
                Log.w(TAG, "${call.methodName} failed: ${e.javaClass.name}")
                call.reject(PluginInput.FAILED, PluginInput.FAILED)
            }
        }
    }

    /** Whether this WebView talks to plugins through WebMessageListener (origin-scoped), not the open fallback. */
    private val webViewSafe: Boolean by lazy {
        try {
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        } catch (e: Exception) {
            Log.w(TAG, "WebView feature check failed: ${e.javaClass.name}")
            false
        }
    }

    /** Whether the WebView is on the configured server's origin right now. Read on the main thread. */
    private suspend fun fromOrbis(): Boolean = withContext(Dispatchers.Main) {
        val bridge = bridge ?: return@withContext false
        PluginInput.sameOrigin(bridge.webView?.url, bridge.serverUrl)
    }

    /** A store call; any failure (e.g. a keystore glitch) becomes `store_unavailable`. */
    private suspend fun <T> store(block: suspend (OrbisStore) -> T): T = try {
        block(OrbisStore.get(context))
    } catch (e: CancellationException) {
        throw e
    } catch (e: Rejection) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "store unavailable: ${e.javaClass.name}")
        throw Rejection(PluginInput.STORE_UNAVAILABLE)
    }

    private suspend fun syncIfRegistered() {
        if (store { it.credential() } != null) SyncScheduler.now(context)
    }

    private suspend fun statusJson(): JSObject {
        data class Snapshot(
            val credential: DeviceCredential?,
            val enabled: Set<Source>,
            val pausedUntil: Long?,
            val pending: Int,
            val lastSync: Long?,
            val lastSyncError: String?,
            val signedOutReason: String?,
        )
        val snap = store { s ->
            val settings = s.settings()
            Snapshot(
                credential = s.credential(),
                enabled = settings.enabled,
                pausedUntil = settings.pausedUntil,
                pending = s.pendingCount(),
                lastSync = s.lastSync(),
                lastSyncError = s.syncError(),
                signedOutReason = s.kvGet(OrbisStore.SIGNED_OUT_REASON),
            )
        }
        return JSObject()
            .put("registered", snap.credential != null)
            .put("userId", nullable(snap.credential?.userId))
            .put("deviceId", nullable(snap.credential?.deviceId))
            .put("distribution", BuildConfig.DISTRIBUTION)
            .put("model", Build.MODEL ?: "")
            .put("manufacturer", Build.MANUFACTURER ?: "")
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("sources", sourcesJson(snap.enabled))
            .put("pausedUntil", nullable(PluginInput.pausedUntilForPage(snap.pausedUntil)))
            .put("pendingSignals", snap.pending)
            .put("lastSyncAt", nullable(snap.lastSync))
            .put("lastSyncError", nullable(snap.lastSyncError))
            .put("batteryOptimized", CoreController.batteryOptimized(context))
            .put("webAuthn", WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION))
            .put("pushReady", pushReady())
            .put("signedOutReason", if (snap.signedOutReason == "revoked") "revoked" else JSONObject.NULL)
    }

    /**
     * True when this build carries Firebase's config (google-services.json became the
     * `google_app_id` string, the resource FirebaseApp itself starts from). Without it the
     * push plugin's register() throws on the plugin thread and takes the app down, so the
     * page asks first.
     */
    @SuppressLint("DiscouragedApi")
    private fun pushReady(): Boolean =
        context.resources.getIdentifier("google_app_id", "string", context.packageName) != 0

    /** All nine wire names, each true or false. */
    private fun sourcesJson(enabled: Set<Source>): JSObject {
        val o = JSObject()
        Source.values().forEach { o.put(it.wire, it in enabled) }
        return o
    }

    /** A list option: null when absent, its items when an array; anything else is refused. */
    private fun arrayOption(call: PluginCall, name: String): List<Any?>? {
        val raw = call.data.opt(name) ?: return null
        if (raw == JSONObject.NULL) return null
        val array = raw as? JSONArray ?: throw Rejection(PluginInput.INVALID_PRIVACY)
        return List(array.length()) { i -> array.opt(i) }
    }

    private fun nullable(value: Any?): Any = value ?: JSONObject.NULL

    private companion object {
        const val TAG = "OrbisCore"
    }
}
