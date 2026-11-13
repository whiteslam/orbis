package app.orbis.core.sync

import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import app.orbis.core.store.DeviceCredential
import app.orbis.core.store.LedgerDay
import app.orbis.core.store.PendingSignal
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class SyncRunnerTest {
    private val cred = DeviceCredential("dev-1", "s3cret-value", "user-1", "https://orbis.example")

    /** Records every call in order, so ordering rules can be asserted. */
    private class FakeStore(var pending: List<PendingSignal> = emptyList()) : SyncStore {
        val calls = mutableListOf<String>()
        var credential: DeviceCredential? = null
        var enabled: Set<Source> = emptySet()
        var ledger: List<LedgerDay> = emptyList()
        var token: String? = null
        var lastSync: Long? = null
        var syncError: String? = null
        var signedOutReason: String? = null
        var failOn: String? = null

        private fun hit(name: String) {
            calls += name
            if (failOn == name) throw IllegalStateException("keystore busy")
        }

        override suspend fun credential(): DeviceCredential? { hit("credential"); return credential }
        override suspend fun prune(now: Long) = hit("prune")
        override suspend fun settings(): PrivacySettings { hit("settings"); return PrivacySettings(enabled = enabled) }
        override suspend fun pendingBatch(limit: Int): List<PendingSignal> { hit("pendingBatch"); return pending.take(limit) }
        override suspend fun markSynced(ids: Collection<String>) {
            hit("markSynced")
            pending = pending.filterNot { it.id in ids }
        }
        override suspend fun ledgerDays(): List<LedgerDay> { hit("ledgerDays"); return ledger }
        override suspend fun pushToken(): String? { hit("pushToken"); return token }
        override suspend fun wipe() { hit("wipe"); pending = emptyList(); lastSync = null; syncError = null; signedOutReason = null; credential = null }
        override suspend fun setSignedOutReason(reason: String) { hit("setSignedOutReason"); signedOutReason = reason }
        override suspend fun setLastSync(at: Long) { hit("setLastSync"); lastSync = at }
        override suspend fun setSyncError(message: String?) { hit("setSyncError"); syncError = message }
    }

    private class FakeClient(vararg val answers: Any) : SyncClient {
        val bodies = mutableListOf<String>()
        val creds = mutableListOf<DeviceCredential>()
        override suspend fun post(credential: DeviceCredential, body: String): SyncReply {
            creds += credential
            bodies += body
            val a = answers[minOf(bodies.size - 1, answers.size - 1)]
            if (a is IOException) throw a
            if (a is SyncReply) return a
            // A bare status: a 2xx comes with the server's counts (R20), anything else with no body.
            val status = a as Int
            return SyncReply(status, if (status in 200..299) COUNTS else null)
        }
    }

    private companion object {
        const val COUNTS = "{\"accepted\":1,\"duplicate\":0,\"refused\":0}"
        const val HTML = "<!DOCTYPE html><html><body>Orbis</body></html>"
    }

    private fun signals(n: Int) = (0 until n).map {
        PendingSignal("id-$it", Source.TEST, "test_item", 1_000L + it, "item $it", 1_000L + it)
    }

    private val logs = mutableListOf<String>()
    private var revokedHooks = 0

    private fun runner(store: FakeStore, client: SyncClient, appVersion: String? = "0.1.0", onRevoked: () -> Unit = { revokedHooks++ }) =
        SyncRunner(store, client, appVersion, now = { 99_000L }, onRevoked = onRevoked, log = { logs += it })

    private fun run(r: SyncRunner) = runBlocking { r.run() }

    @Test
    fun noCredentialMeansSuccessAndNoRequest() {
        val store = FakeStore()
        val client = FakeClient(200)
        assertEquals(SyncRunner.Result.Success, run(runner(store, client)))
        assertTrue(client.bodies.isEmpty())
        assertFalse("prune" in store.calls)
    }

    @Test
    fun noPendingSignalsStillPostsOneRequestForSourcesLedgerAndMeta() {
        val store = FakeStore().apply {
            credential = cred
            enabled = setOf(Source.TEST, Source.CALENDAR)
            ledger = listOf(LedgerDay("2026-11-12", Source.TEST, 1, 2, 0))
            token = "tok-1"
        }
        val client = FakeClient(200)
        assertEquals(SyncRunner.Result.Success, run(runner(store, client)))
        assertEquals(1, client.bodies.size)
        val body = JSONObject(client.bodies[0])
        assertEquals(0, body.getJSONArray("signals").length())
        assertEquals(9, body.getJSONArray("sources").length()) // the phone is the authority: all 9, on or off
        val states = (0 until 9).associate { body.getJSONArray("sources").getJSONObject(it).let { s -> s.getString("source") to s.getBoolean("enabled") } }
        assertEquals(setOf("test", "calendar"), states.filterValues { it }.keys)
        assertEquals(1, body.getJSONArray("ledger").length())
        assertEquals("0.1.0", body.getJSONObject("meta").getString("appVersion"))
        assertEquals("tok-1", body.getJSONObject("meta").getString("pushToken"))
        assertEquals(cred, client.creds[0])
    }

    @Test
    fun noPushTokenMeansNoPushTokenKey() {
        val store = FakeStore().apply { credential = cred }
        val client = FakeClient(200)
        run(runner(store, client))
        assertFalse(JSONObject(client.bodies[0]).getJSONObject("meta").has("pushToken"))
    }

    @Test
    fun pruneRunsBeforeAnyRequest() {
        val store = FakeStore(signals(1)).apply { credential = cred }
        run(runner(store, FakeClient(200)))
        assertTrue(store.calls.indexOf("prune") in 0 until store.calls.indexOf("pendingBatch"))
    }

    @Test
    fun aDoneBatchIsMarkedSyncedAndLastSyncIsSet() {
        val store = FakeStore(signals(3)).apply { credential = cred; syncError = "HTTP 503" }
        assertEquals(SyncRunner.Result.Success, run(runner(store, FakeClient(200))))
        assertTrue(store.pending.isEmpty())
        assertEquals(99_000L, store.lastSync)
        assertNull(store.syncError)
    }

    @Test
    fun atMostFiveBatchesPerRun() {
        val store = FakeStore(signals(700)).apply { credential = cred }
        val client = FakeClient(200)
        assertEquals(SyncRunner.Result.Success, run(runner(store, client)))
        assertEquals(5, client.bodies.size)
        assertEquals(200, store.pending.size)
    }

    @Test
    fun aRetryKeepsTheSignalsKeepsLastSyncAndRecordsTheError() {
        val store = FakeStore(signals(3)).apply { credential = cred; lastSync = 5L }
        assertEquals(SyncRunner.Result.Retry, run(runner(store, FakeClient(503))))
        assertEquals(3, store.pending.size)
        assertEquals(5L, store.lastSync)
        assertEquals("HTTP 503", store.syncError)
    }

    // R20: production's 200 text/html for the undeployed route must not empty the outbox.
    @Test
    fun a200HtmlReplyLeavesTheBatchPendingAndRecordsTheError() {
        val store = FakeStore(signals(3)).apply { credential = cred; lastSync = 5L }
        assertEquals(SyncRunner.Result.Retry, run(runner(store, FakeClient(SyncReply(200, HTML)))))
        assertEquals(3, store.pending.size)
        assertFalse("markSynced" in store.calls)
        assertEquals(5L, store.lastSync)
        assertEquals("unexpected response", store.syncError)
        assertFalse(logs.joinToString("\n").contains("<html>"))
    }

    @Test
    fun a204OrAJsonReplyWithoutTheCountsIsARetryToo() {
        for (reply in listOf(SyncReply(204, null), SyncReply(200, "{\"accepted\":1}"), SyncReply(200, ""))) {
            val store = FakeStore(signals(2)).apply { credential = cred }
            assertEquals(SyncRunner.Result.Retry, run(runner(store, FakeClient(reply))))
            assertEquals(2, store.pending.size)
            assertEquals("unexpected response", store.syncError)
        }
    }

    @Test
    fun aNetworkErrorIsARetryToo() {
        val store = FakeStore(signals(3)).apply { credential = cred; lastSync = 5L }
        assertEquals(SyncRunner.Result.Retry, run(runner(store, FakeClient(IOException("no route")))))
        assertEquals(3, store.pending.size)
        assertEquals("network", store.syncError)
        assertEquals(5L, store.lastSync)
    }

    @Test
    fun aLaterBatchFailingKeepsTheEarlierBatchSynced() {
        val store = FakeStore(signals(250)).apply { credential = cred }
        assertEquals(SyncRunner.Result.Retry, run(runner(store, FakeClient(200, 500))))
        assertEquals(150, store.pending.size)
        assertNull(store.lastSync)
    }

    @Test
    fun aBadRequestOrTooLargeBatchIsDroppedAndLoggedWithoutContent() {
        for (status in listOf(400, 413)) {
            logs.clear()
            val store = FakeStore(signals(3)).apply { credential = cred }
            assertEquals(SyncRunner.Result.Success, run(runner(store, FakeClient(status))))
            assertTrue(store.pending.isEmpty())
            val line = logs.joinToString("\n")
            assertTrue(line.contains(status.toString()))
            assertTrue(line.contains("3"))
            assertFalse(line.contains("item 0"))
            assertFalse(line.contains("s3cret-value"))
        }
    }

    @Test
    fun revokedWipesThenWritesTheReasonThenCallsTheHookThenSucceeds() {
        for (status in listOf(401)) {
            val order = mutableListOf<String>()
            val store = FakeStore(signals(3)).apply { credential = cred }
            val r = runner(store, FakeClient(status), onRevoked = { order += "hook:" + store.signedOutReason })
            assertEquals(SyncRunner.Result.Success, run(r))
            val tail = store.calls.takeLast(2)
            assertEquals(listOf("wipe", "setSignedOutReason"), tail)
            assertEquals("revoked", store.signedOutReason) // written after the wipe, which clears it
            assertEquals(listOf("hook:revoked"), order) // hook runs after the reason is stored
            assertNull(store.credential)
            assertTrue(store.pending.isEmpty())
            assertNull(store.lastSync)
        }
    }

    @Test
    fun revokedStopsTheRunEvenWithBatchesLeft() {
        val store = FakeStore(signals(250)).apply { credential = cred }
        val client = FakeClient(401)
        run(runner(store, client))
        assertEquals(1, client.bodies.size)
    }

    @Test
    fun aStoreFailureIsARetryNotACrash() {
        for (name in listOf("credential", "prune", "settings", "pendingBatch", "ledgerDays", "pushToken", "markSynced", "setLastSync")) {
            val store = FakeStore(signals(1)).apply { credential = cred; failOn = name }
            assertEquals("failure in $name", SyncRunner.Result.Retry, run(runner(store, FakeClient(200))))
        }
    }

    @Test
    fun aFailingWipeIsARetryAndNeverCallsTheHook() {
        val store = FakeStore(signals(1)).apply { credential = cred; failOn = "wipe" }
        assertEquals(SyncRunner.Result.Retry, run(runner(store, FakeClient(401))))
        assertEquals(0, revokedHooks)
    }

    @Test
    fun aThrowingHookAfterTheWipeStillEndsInSuccessWithNoSyncError() {
        val store = FakeStore(signals(2)).apply { credential = cred; syncError = null }
        val r = runner(store, FakeClient(401), onRevoked = { throw IllegalStateException("hook broke") })
        assertEquals(SyncRunner.Result.Success, run(r))
        assertEquals("revoked", store.signedOutReason)
        assertNull(store.syncError) // nothing is written into the freshly wiped store
        assertNull(store.lastSync)
        assertFalse(logs.joinToString(" ").contains("hook broke")) // class name only
    }

    @Test
    fun aFailingReasonWriteAfterTheWipeStillCallsTheHookAndSucceeds() {
        val store = FakeStore(signals(2)).apply { credential = cred; failOn = "setSignedOutReason" }
        assertEquals(SyncRunner.Result.Success, run(runner(store, FakeClient(401))))
        assertEquals(1, revokedHooks)
        assertNull(store.syncError)
    }

    @Test
    fun aRefusedSignalLessRequestIsNotASuccessfulSync() {
        for (status in listOf(400, 413)) {
            val store = FakeStore().apply { credential = cred; lastSync = 5L }
            val client = FakeClient(status)
            assertEquals(SyncRunner.Result.Success, run(runner(store, client))) // no retry loop
            assertEquals(1, client.bodies.size)
            assertEquals("HTTP $status", store.syncError)
            assertEquals(5L, store.lastSync) // not advanced
        }
    }

    @Test
    fun aRefusedBatchWithSignalsStillCountsAsDone() {
        val store = FakeStore(signals(2)).apply { credential = cred; syncError = "HTTP 503" }
        assertEquals(SyncRunner.Result.Success, run(runner(store, FakeClient(400))))
        assertEquals(99_000L, store.lastSync)
        assertNull(store.syncError)
    }

    @Test
    fun theLogNeverHoldsTheSecretOrContent() {
        val store = FakeStore(signals(2)).apply { credential = cred }
        run(runner(store, FakeClient(503)))
        run(runner(store, FakeClient(IOException("boom s3cret-value"))))
        val all = logs.joinToString("\n")
        assertFalse(all.contains("s3cret-value"))
        assertFalse(all.contains("item 0"))
    }
}
