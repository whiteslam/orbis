package app.orbis.core.sync

import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import app.orbis.core.store.DeviceCredential
import app.orbis.core.store.LedgerDay
import app.orbis.core.store.OrbisStore
import app.orbis.core.store.PendingSignal
import kotlinx.coroutines.CancellationException
import java.io.IOException

/** What [SyncRunner] needs from the store, so the decision flow can be tested on the JVM. */
interface SyncStore {
    suspend fun credential(): DeviceCredential?
    suspend fun prune(now: Long)
    suspend fun settings(): PrivacySettings
    suspend fun pendingBatch(limit: Int): List<PendingSignal>
    suspend fun markSynced(ids: Collection<String>)
    suspend fun ledgerDays(): List<LedgerDay>
    suspend fun pushToken(): String?
    suspend fun wipe()

    /** Saves `signedOutReason`. Called after [wipe], which clears it. */
    suspend fun setSignedOutReason(reason: String)
    suspend fun setLastSync(at: Long)

    /** Saves a short reason the last sync failed; null clears it. */
    suspend fun setSyncError(message: String?)
}

/** [SyncStore] over the real [OrbisStore]. */
class OrbisSyncStore(private val store: OrbisStore) : SyncStore {
    override suspend fun credential() = store.credential()
    override suspend fun prune(now: Long) = store.prune(now)
    override suspend fun settings() = store.settings()
    override suspend fun pendingBatch(limit: Int) = store.pendingBatch(limit)
    override suspend fun markSynced(ids: Collection<String>) = store.markSynced(ids)
    override suspend fun ledgerDays() = store.ledgerDays()
    override suspend fun pushToken() = store.pushToken()
    override suspend fun wipe() = store.wipe()
    override suspend fun setSignedOutReason(reason: String) = store.kvPut(OrbisStore.SIGNED_OUT_REASON, reason)
    override suspend fun setLastSync(at: Long) = store.setLastSync(at)
    override suspend fun setSyncError(message: String?) = store.setSyncError(message)
}

/**
 * One sync run: prune, then post up to [MAX_BATCHES] batches. Never throws (except for
 * cancellation): a failing store or network is [Result.Retry].
 *
 * [log] gets status codes and counts only, never content, the push token or the credential.
 */
class SyncRunner(
    private val store: SyncStore,
    private val client: SyncClient,
    private val appVersion: String?,
    private val now: () -> Long = System::currentTimeMillis,
    private val onRevoked: () -> Unit,
    private val log: (String) -> Unit,
) {
    enum class Result { Success, Retry }

    suspend fun run(): Result {
        return try {
            runOnce()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A transient keystore or database failure. Class name only: messages can carry paths or values.
            log("sync: store error (${e.javaClass.simpleName}), will retry")
            fail("storage")
        }
    }

    private suspend fun runOnce(): Result {
        val credential = store.credential() ?: return Result.Success
        store.prune(now())

        // The phone is the authority for sources: every sync sends all of them with their current state.
        val enabled = store.settings().enabled
        val sources = Source.values().map { SourceState(it, it in enabled) }
        val ledger = store.ledgerDays()
        val meta = SyncMeta(appVersion = appVersion, pushToken = store.pushToken())

        val pending = store.pendingBatch(MAX_BATCHES * SyncPlanner.MAX_COUNT)
        // With nothing pending, still post once so sources, ledger and meta reach the server.
        val batches = SyncPlanner.batches(pending).take(MAX_BATCHES).ifEmpty { listOf(emptyList()) }

        var rejected: Int? = null
        for (batch in batches) {
            val body = SyncPayload.toJson(meta, sources, batch, ledger)
            val reply = try {
                client.post(credential, body)
            } catch (e: IOException) {
                log("sync: network error (${e.javaClass.simpleName}), will retry")
                return fail("network")
            }
            val status = reply.status
            when (SyncOutcome.from(status, reply.body)) {
                SyncOutcome.Done -> {
                    if (SyncOutcome.isDropped(status)) {
                        log("sync: server answered $status, dropped ${batch.size} signals")
                        // A refusal of the signal-less request means sources, ledger and meta did not
                        // sync, so it is not a successful sync.
                        if (batch.isEmpty()) rejected = status
                    }
                    store.markSynced(batch.map { it.id })
                }
                SyncOutcome.Revoked -> {
                    log("sync: server answered $status, signing out")
                    store.wipe()
                    // The wipe is done: from here on nothing may turn the run into a retry, or write a
                    // sync error into the fresh store. wipe() clears every saved value, so the reason is
                    // written after it.
                    afterWipe("saving the reason") { store.setSignedOutReason(REVOKED) }
                    afterWipe("the revoke hook") { onRevoked() }
                    return Result.Success
                }
                SyncOutcome.Retry -> {
                    // R20: a 2xx without the server's counts (an HTML page, a portal) keeps the batch.
                    // The log never holds the body.
                    if (SyncOutcome.isUnexpected(status, reply.body)) {
                        log("sync: server answered $status without the expected counts, will retry")
                        return fail(UNEXPECTED_RESPONSE)
                    }
                    log("sync: server answered $status, will retry")
                    return fail("HTTP $status")
                }
            }
        }

        if (rejected != null) {
            // No retry (the server would refuse it again), but no lastSync either.
            store.setSyncError("HTTP $rejected")
            return Result.Success
        }
        store.setLastSync(now())
        store.setSyncError(null)
        return Result.Success
    }

    /** Runs a step after a completed wipe. A failure is logged by class name and otherwise ignored. */
    private suspend fun afterWipe(what: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log("sync: $what failed after sign-out (${e.javaClass.simpleName})")
        }
    }

    /** Keeps lastSync, records why, and asks for a retry. The note itself must not turn a retry into a crash. */
    private suspend fun fail(reason: String): Result {
        try {
            store.setSyncError(reason)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
        return Result.Retry
    }

    companion object {
        const val MAX_BATCHES = 5
        const val REVOKED = "revoked"
        const val UNEXPECTED_RESPONSE = "unexpected response"
    }
}
