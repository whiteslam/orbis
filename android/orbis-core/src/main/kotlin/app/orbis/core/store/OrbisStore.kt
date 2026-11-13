package app.orbis.core.store

import android.content.Context
import android.database.sqlite.SQLiteDatabaseCorruptException
import androidx.room.withTransaction
import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.zetetic.database.sqlcipher.SQLiteNotADatabaseException
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** The credential the phone signs its sync requests with. [toString] never shows the secret. */
data class DeviceCredential(
    val deviceId: String,
    val secret: String,
    val userId: String,
    val serverUrl: String,
) {
    override fun toString(): String =
        "DeviceCredential(deviceId=$deviceId, userId=$userId, serverUrl=$serverUrl, secret=<hidden>)"
}

/** One source's counts for one local day (`yyyy-MM-dd`), as the sync request's ledger sends it. */
data class LedgerDay(
    val day: String,
    val source: Source,
    val kept: Int,
    val dropped: Int,
    val actions: Int,
)

/**
 * Everything Orbis keeps on the phone, in a SQLCipher database whose key is wrapped by the
 * Android Keystore ([KeyManager]). Settings and the device credential live inside the encrypted
 * database too. Every call is safe from any thread; work runs on [Dispatchers.IO].
 *
 * Prefer [OrbisStore.get] for the one shared instance per process.
 */
class OrbisStore(context: Context) : Closeable {
    private val context = context.applicationContext
    private val lock = Any()
    private var opened: OrbisDatabase? = null
    private val pipeline = CapturePipeline(Port())

    // --- capture ----------------------------------------------------------------------------

    /** Runs [item] through the privacy rules with the saved settings and stores the result. */
    suspend fun capture(item: CapturedItem, now: Long = System.currentTimeMillis()): Decision =
        io { pipeline.capture(item, readSettings(db()), now) }

    // --- settings ---------------------------------------------------------------------------

    /** The saved privacy settings, or the defaults (every source off, default blocklist). */
    suspend fun settings(): PrivacySettings = io { readSettings(db()) }

    suspend fun saveSettings(settings: PrivacySettings) = io { writeSettings(db(), settings) }

    /** Turns a source on or off. Turning it off deletes its raw items and pending signals. */
    suspend fun setSourceEnabled(source: Source, on: Boolean): PrivacySettings = io {
        val db = db()
        db.withTransaction {
            val current = readSettings(db)
            val next = current.copy(enabled = if (on) current.enabled + source else current.enabled - source)
            writeSettings(db, next)
            if (!on) {
                db.rawItems().deleteBySource(source)
                db.signals().deleteBySource(source)
            }
            next
        }
    }

    /** Pauses reading until [until] (epoch ms, or [app.orbis.core.rules.PAUSED_FOREVER]); null resumes. */
    suspend fun pause(until: Long?): PrivacySettings = io {
        val db = db()
        db.withTransaction {
            val next = readSettings(db).copy(pausedUntil = until)
            writeSettings(db, next)
            next
        }
    }

    // --- outbox -----------------------------------------------------------------------------

    /** Up to [limit] pending signals, oldest first. */
    suspend fun pendingBatch(limit: Int): List<PendingSignal> = io { db().signals().oldest(limit) }

    suspend fun pendingCount(): Int = io { db().signals().count() }

    /** Removes sent signals from the outbox. */
    suspend fun markSynced(ids: Collection<String>) = io {
        val db = db()
        db.withTransaction { ids.distinct().chunked(SQL_CHUNK).forEach { db.signals().deleteIds(it) } }
    }

    // --- ledger -----------------------------------------------------------------------------

    /**
     * Kept, dropped and action counts per local day and source, for the last [maxDays] local
     * days including today (the server takes at most 90 rows: 9 sources x 10 days). Ordered by
     * day, then source.
     */
    suspend fun ledgerDays(
        maxDays: Int = LEDGER_SYNC_DAYS,
        now: Long = System.currentTimeMillis(),
        timeZone: TimeZone = TimeZone.getDefault(),
    ): List<LedgerDay> = io {
        require(maxDays >= 1) { "maxDays must be at least 1" }
        val cal = Calendar.getInstance(timeZone).apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        cal.add(Calendar.DAY_OF_YEAR, 1)
        val until = cal.timeInMillis // start of tomorrow
        cal.add(Calendar.DAY_OF_YEAR, -maxDays)
        val from = cal.timeInMillis
        // Locale.US keeps the digits ASCII whatever the phone's language.
        val format = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { this.timeZone = timeZone }
        db().ledger().between(from, until)
            .groupBy { format.format(Date(it.at)) to it.source }
            .map { (key, rows) ->
                LedgerDay(
                    day = key.first,
                    source = key.second,
                    kept = rows.count { it.decision == LedgerEntry.KEPT },
                    dropped = rows.count { it.decision == LedgerEntry.DROPPED },
                    actions = rows.count { it.decision == LedgerEntry.ACTION },
                )
            }
            .sortedWith(compareBy({ it.day }, { it.source.ordinal }))
    }

    /** The newest ledger rows, newest first. */
    suspend fun recentActivity(limit: Int): List<LedgerEntry> = io { db().ledger().newest(limit) }

    // --- retention --------------------------------------------------------------------------

    /** Drops raw items older than 30 days, ledger rows older than 90 days and outbox items past the 5,000 newest. */
    suspend fun prune(now: Long = System.currentTimeMillis()) = io {
        val db = db()
        db.withTransaction {
            db.rawItems().deleteCapturedBefore(now - RAW_RETENTION_MS)
            db.ledger().deleteBefore(now - LEDGER_RETENTION_MS)
            db.signals().trim(OUTBOX_CAP)
        }
    }

    // --- credential and small values --------------------------------------------------------

    suspend fun credential(): DeviceCredential? = io {
        db().kv().get(KEY_CREDENTIAL)?.let { raw ->
            runCatching {
                val o = JSONObject(raw)
                DeviceCredential(o.getString("deviceId"), o.getString("secret"), o.getString("userId"), o.getString("serverUrl"))
            }.getOrNull()
        }
    }

    suspend fun saveCredential(credential: DeviceCredential) = io {
        val o = JSONObject()
            .put("deviceId", credential.deviceId)
            .put("secret", credential.secret)
            .put("userId", credential.userId)
            .put("serverUrl", credential.serverUrl)
        db().kv().put(Kv(KEY_CREDENTIAL, o.toString()))
    }

    suspend fun clearCredential() = io { db().kv().delete(KEY_CREDENTIAL) }

    /** Epoch ms of the last successful sync, or null. */
    suspend fun lastSync(): Long? = io { db().kv().get(LAST_SYNC)?.toLongOrNull() }

    suspend fun setLastSync(at: Long) = io { db().kv().put(Kv(LAST_SYNC, at.toString())) }

    /** A small saved value, e.g. [SIGNED_OUT_REASON]. Settings and the credential have their own calls. */
    suspend fun kvGet(key: String): String? = io { db().kv().get(checkKey(key)) }

    /** Saves a small value; null deletes it. */
    suspend fun kvPut(key: String, value: String?) = io {
        if (value == null) db().kv().delete(checkKey(key)) else db().kv().put(Kv(checkKey(key), value))
    }

    // --- wipe -------------------------------------------------------------------------------

    /**
     * Deletes every row of every table: raw items, outbox, ledger and all small values, which
     * includes the credential, last sync and any signed-out reason. Settings go back to their
     * defaults. A caller that wants to keep a value (e.g. `signedOutReason`) writes it afterwards.
     */
    suspend fun wipe() = io { db().clearAllTables() }

    override fun close() {
        synchronized(lock) {
            opened?.close()
            opened = null
        }
    }

    // --- internals --------------------------------------------------------------------------

    private inner class Port : StorePort {
        override suspend fun insertKept(raw: RawItem, signal: PendingSignal?, entry: LedgerEntry) {
            val db = db()
            db.withTransaction {
                db.rawItems().insert(raw)
                if (signal != null) {
                    db.signals().insert(signal)
                    db.signals().trim(OUTBOX_CAP)
                }
                db.ledger().insert(entry)
            }
        }

        override suspend fun insertDropped(entry: LedgerEntry) {
            db().ledger().insert(entry)
        }
    }

    private suspend fun <T> io(block: suspend () -> T): T = withContext(Dispatchers.IO) { block() }

    /** The open database. Call on a background thread. */
    internal fun db(): OrbisDatabase = synchronized(lock) { opened ?: open().also { opened = it } }

    private fun open(): OrbisDatabase {
        val keys = KeyManager(context)
        val db = OrbisDatabase.build(context, keys.passphrase())
        try {
            db.openHelper.writableDatabase
            return db
        } catch (e: Exception) {
            if (!isWrongKey(e)) throw e
            // The saved key doesn't open this file: it can never be read. Start fresh.
            db.close()
            keys.reset()
            return OrbisDatabase.build(context, keys.passphrase()).also { it.openHelper.writableDatabase }
        }
    }

    private fun isWrongKey(e: Throwable): Boolean =
        generateSequence(e) { it.cause }.take(10).any {
            it is SQLiteNotADatabaseException || it is SQLiteDatabaseCorruptException
        }

    private suspend fun readSettings(db: OrbisDatabase): PrivacySettings =
        db.kv().get(KEY_SETTINGS)?.let(::decodeSettings) ?: PrivacySettings()

    private suspend fun writeSettings(db: OrbisDatabase, settings: PrivacySettings) =
        db.kv().put(Kv(KEY_SETTINGS, encodeSettings(settings)))

    private fun checkKey(key: String): String {
        require(!key.startsWith(INTERNAL_PREFIX)) { "Reserved key" }
        return key
    }

    private fun encodeSettings(s: PrivacySettings): String = JSONObject()
        .put("enabled", JSONArray(s.enabled.map { it.wire }.sorted()))
        .put("blockedPackages", JSONArray(s.blockedPackages.sorted()))
        .put("blockedContacts", JSONArray(s.blockedContacts.sorted()))
        .put("blockedKeywords", JSONArray(s.blockedKeywords))
        // A string, so Long.MAX_VALUE (paused until resumed) survives exactly.
        .put("pausedUntil", s.pausedUntil?.toString() ?: JSONObject.NULL)
        .toString()

    private fun decodeSettings(raw: String): PrivacySettings? = runCatching {
        val o = JSONObject(raw)
        fun strings(name: String): List<String> {
            val a = o.getJSONArray(name)
            return List(a.length()) { a.getString(it) }
        }
        PrivacySettings(
            enabled = strings("enabled").mapNotNull(Source::fromWire).toSet(),
            blockedPackages = strings("blockedPackages").toSet(),
            blockedContacts = strings("blockedContacts").toSet(),
            blockedKeywords = strings("blockedKeywords"),
            pausedUntil = if (o.isNull("pausedUntil")) null else o.getString("pausedUntil").toLong(),
        )
    }.getOrNull()

    companion object {
        /** Saved by the sync worker after a revoke wipes the store. */
        const val SIGNED_OUT_REASON = "signedOutReason"
        const val LAST_SYNC = "lastSync"

        /** Ledger days a sync sends. */
        const val LEDGER_SYNC_DAYS = 10
        const val OUTBOX_CAP = 5_000
        const val RAW_RETENTION_MS = 30L * 24 * 60 * 60 * 1000
        const val LEDGER_RETENTION_MS = 90L * 24 * 60 * 60 * 1000

        private const val INTERNAL_PREFIX = "orbis."
        private const val KEY_SETTINGS = "orbis.settings"
        private const val KEY_CREDENTIAL = "orbis.credential"
        private const val SQL_CHUNK = 500

        @Volatile
        private var shared: OrbisStore? = null

        /** The one store for this process. Don't close it. */
        fun get(context: Context): OrbisStore =
            shared ?: synchronized(this) { shared ?: OrbisStore(context).also { shared = it } }
    }
}
