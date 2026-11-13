package app.orbis.core.store

import android.content.Context
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.Decision
import app.orbis.core.rules.DropReason
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import java.util.TimeZone

@RunWith(AndroidJUnit4::class)
class OrbisStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dbFile: File get() = context.getDatabasePath(OrbisDatabase.NAME)
    private val now = System.currentTimeMillis()
    private val day = 24L * 60 * 60 * 1000
    private var store = OrbisStore(context)

    @Before
    fun fresh() {
        store.close()
        KeyManager(context).reset()
        store = OrbisStore(context)
    }

    @After
    fun closeStore() {
        store.close()
    }

    private fun reopen() {
        store.close()
        store = OrbisStore(context)
    }

    private fun item(source: Source = Source.TEST, text: String, pkg: String? = null, contacts: List<String> = emptyList()) =
        CapturedItem(source, pkg, contacts, text, now - 1000, false)

    /** Row counts of every table that holds Orbis data. */
    private fun tableCounts(): Map<String, Int> {
        val db = store.db().openHelper.writableDatabase
        val names = mutableListOf<String>()
        db.query("SELECT name FROM sqlite_master WHERE type = 'table'").use { c ->
            while (c.moveToNext()) names += c.getString(0)
        }
        val bookkeeping = setOf("android_metadata", "room_master_table", "sqlite_sequence")
        return names.filter { it !in bookkeeping }.associateWith { name ->
            db.query("SELECT COUNT(*) FROM `$name`").use { c -> c.moveToFirst(); c.getInt(0) }
        }
    }

    @Test
    fun captureSurvivesReopenAndTheFileIsEncrypted() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        val decision = store.capture(item(text = "Your OTP is 123456 for the plaintextmarker order"))
        assertEquals(Decision.Keep("Your OTP is [code] for the plaintextmarker order"), decision)

        reopen()
        val pending = store.pendingBatch(10)
        assertEquals(1, pending.size)
        assertEquals("Your OTP is [code] for the plaintextmarker order", pending[0].content)
        assertEquals("test_item", pending[0].kind)
        assertTrue(Source.TEST in store.settings().enabled)
        assertEquals(listOf(LedgerEntry.KEPT), store.recentActivity(10).map { it.decision })

        store.close()
        val header = ByteArray(16)
        dbFile.inputStream().use { assertEquals(16, it.read(header)) }
        assertFalse(header.contentEquals("SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)))
        // No plain text anywhere on disk, including a write-ahead log if one is left.
        for (f in listOf(dbFile, File(dbFile.path + "-wal"), File(dbFile.path + "-journal"))) {
            if (f.exists()) assertFalse(f.name, String(f.readBytes(), Charsets.ISO_8859_1).contains("plaintextmarker"))
        }
    }

    @Test
    fun turningASourceOffDeletesItsItemsButKeepsTheLedger() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        store.setSourceEnabled(Source.NOTIFICATIONS, true)
        store.capture(item(text = "first"))
        store.capture(item(text = "second"))
        store.capture(item(Source.NOTIFICATIONS, text = "a notification", pkg = "com.example.chat"))
        assertEquals(3, store.pendingCount())

        val settings = store.setSourceEnabled(Source.TEST, false)
        assertFalse(Source.TEST in settings.enabled)
        assertFalse(Source.TEST in store.settings().enabled)
        val left = store.pendingBatch(10)
        assertEquals(listOf(Source.NOTIFICATIONS), left.map { it.source })
        assertEquals(1, store.db().rawItems().count())
        assertEquals(Source.NOTIFICATIONS, store.db().rawItems().newest(10).single().source)
        assertEquals(3, store.recentActivity(10).size)

        // A capture from the now-off source is dropped.
        assertEquals(Decision.Drop(DropReason.SOURCE_OFF), store.capture(item(text = "third")))
        assertEquals(1, store.pendingCount())
    }

    @Test
    fun captureRacingASourceOffNeverLeavesItsRows() = runBlocking {
        // Each capture reads the settings and writes in one transaction, so no capture that saw
        // the source on can commit after the off deleted the source's rows.
        repeat(10) { round ->
            store.setSourceEnabled(Source.TEST, true)
            val before = (0 until 40).map { i -> async(Dispatchers.IO) { store.capture(item(text = "race $round a$i")) } }
            val off = async(Dispatchers.IO) { store.setSourceEnabled(Source.TEST, false) }
            val after = (0 until 40).map { i -> async(Dispatchers.IO) { store.capture(item(text = "race $round b$i")) } }
            (before + off + after).awaitAll()
            assertEquals("round $round raw items", 0, store.db().rawItems().count())
            assertEquals("round $round pending signals", 0, store.pendingCount())
        }
    }

    @Test
    fun malformedSavedKeyStartsAFreshStore() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        store.capture(item(text = "before"))
        store.close()
        context.getSharedPreferences(KeyManager.PREFS, Context.MODE_PRIVATE).edit()
            .putString(KeyManager.WRAPPED, "not base64 !!").commit()

        store = OrbisStore(context)
        assertEquals(0, store.pendingCount())
        assertEquals(PrivacySettings(), store.settings())
    }

    @Test
    fun kvToStringHidesTheValue() {
        assertFalse(Kv("orbis.credential", "secretvalue").toString().contains("secretvalue"))
    }

    @Test
    fun wipeEmptiesEveryTableAndTheCredential() = runBlocking {
        store.saveSettings(
            PrivacySettings(
                enabled = setOf(Source.TEST),
                blockedPackages = setOf("com.secret.bank"),
                blockedContacts = setOf("9876543210"),
                blockedKeywords = listOf("hush"),
            ),
        )
        store.capture(item(text = "kept one"))
        store.capture(item(text = "dropped hush"))
        store.capture(item(text = "dropped app", pkg = "com.secret.bank"))
        store.pause(now + day)
        store.saveCredential(DeviceCredential("7b0f6c1e-3a52-4c8e-9d41-2f6a8b1c0001", "s".repeat(43), "user-1", "https://example.test"))
        store.setLastSync(now)
        store.kvPut(OrbisStore.SIGNED_OUT_REASON, "revoked")
        assertTrue(tableCounts().values.all { it > 0 })
        assertEquals(setOf("raw_item", "pending_signal", "ledger_entry", "kv"), tableCounts().keys)

        store.wipe()

        assertEquals(mapOf("raw_item" to 0, "pending_signal" to 0, "ledger_entry" to 0, "kv" to 0), tableCounts())
        assertNull(store.credential())
        assertNull(store.lastSync())
        assertNull(store.kvGet(OrbisStore.SIGNED_OUT_REASON))
        assertEquals(PrivacySettings(), store.settings())
        assertEquals(0, store.pendingCount())

        // The caller can record why after the wipe, and it survives a reopen.
        store.kvPut(OrbisStore.SIGNED_OUT_REASON, "revoked")
        reopen()
        assertEquals("revoked", store.kvGet(OrbisStore.SIGNED_OUT_REASON))
        assertNull(store.credential())
    }

    @Test
    fun credentialRoundTripsAndNeverPrintsTheSecret() = runBlocking {
        val credential = DeviceCredential("7b0f6c1e-3a52-4c8e-9d41-2f6a8b1c0001", "secretvalue".repeat(4), "user-1", "https://example.test")
        assertNull(store.credential())
        store.saveCredential(credential)
        reopen()
        assertEquals(credential, store.credential())
        assertFalse(credential.toString().contains("secretvalue"))
        store.clearCredential()
        assertNull(store.credential())
    }

    @Test
    fun settingsAndPauseRoundTrip() = runBlocking {
        assertEquals(PrivacySettings(), store.settings())
        val custom = PrivacySettings(
            enabled = setOf(Source.TEST, Source.CALENDAR),
            blockedPackages = setOf("a.b"),
            blockedContacts = setOf("asha rao"),
            blockedKeywords = listOf("one", "two words"),
            pausedUntil = null,
        )
        store.saveSettings(custom)
        assertEquals(custom.copy(pausedUntil = PrivacySettings.PAUSED_FOREVER), store.pause(PrivacySettings.PAUSED_FOREVER))
        reopen()
        assertEquals(PrivacySettings.PAUSED_FOREVER, store.settings().pausedUntil)
        assertEquals(Decision.Drop(DropReason.PAUSED), store.capture(item(text = "x")))
        store.pause(null)
        assertEquals(custom, store.settings())
    }

    @Test
    fun updateSettingsChangesOnlyWhatTheTransformChangesAndRacesNoToggle() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        store.pause(1_000L)
        val saved = store.updateSettings { it.copy(blockedKeywords = listOf("secret")) }
        assertEquals(setOf(Source.TEST), saved.enabled)
        assertEquals(1_000L, saved.pausedUntil)
        assertEquals(listOf("secret"), saved.blockedKeywords)
        reopen()
        assertEquals(saved, store.settings())
        // Concurrent list edits and source toggles: every toggle survives.
        val sources = listOf(Source.CALENDAR, Source.CONTACTS, Source.CALLS, Source.HEALTH, Source.USAGE)
        sources.mapIndexed { i, source ->
            listOf(
                async(Dispatchers.IO) { store.setSourceEnabled(source, true) },
                async(Dispatchers.IO) { store.updateSettings { it.copy(blockedPackages = it.blockedPackages + "p$i") } },
            )
        }.flatten().awaitAll()
        val after = store.settings()
        assertTrue(after.enabled.containsAll(sources))
        assertTrue(after.blockedPackages.containsAll(List(sources.size) { "p$it" }))
    }

    @Test
    fun outboxDrainsOldestFirstAndMarkSyncedRemoves() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        for (i in 1..5) store.capture(item(text = "item $i"), now = now + i)
        val batch = store.pendingBatch(3)
        assertEquals(listOf("item 1", "item 2", "item 3"), batch.map { it.content })
        store.markSynced(batch.map { it.id })
        assertEquals(listOf("item 4", "item 5"), store.pendingBatch(10).map { it.content })
        store.markSynced(emptyList())
        assertEquals(2, store.pendingCount())
    }

    @Test
    fun ledgerDaysUsesTheLocalDayAndOnlyTheLastTenDays() = runBlocking {
        val zone = TimeZone.getTimeZone("Asia/Kolkata") // UTC+5:30
        // 2026-11-12T20:00:00Z is 2026-11-13 01:30 in Kolkata.
        val today = 1_794_513_600_000L
        store.setSourceEnabled(Source.TEST, true)
        store.capture(item(text = "today kept"), now = today)
        store.capture(item(text = "today dropped", pkg = "com.authy.authy"), now = today)
        store.capture(item(text = "late yesterday UTC, today local"), now = today - 60 * 60 * 1000)
        store.capture(item(text = "a day back"), now = today - day)
        store.capture(item(Source.CALENDAR, text = "off source"), now = today - day)
        store.capture(item(text = "nine days back"), now = today - 9 * day)
        store.capture(item(text = "ten days back"), now = today - 10 * day)
        store.capture(item(text = "in the future"), now = today + 2 * day)

        val days = store.ledgerDays(now = today, timeZone = zone)
        assertEquals(
            listOf(
                LedgerDay("2026-11-04", Source.TEST, kept = 1, dropped = 0, actions = 0),
                LedgerDay("2026-11-12", Source.TEST, kept = 1, dropped = 0, actions = 0),
                LedgerDay("2026-11-12", Source.CALENDAR, kept = 0, dropped = 1, actions = 0),
                LedgerDay("2026-11-13", Source.TEST, kept = 2, dropped = 1, actions = 0),
            ),
            days,
        )
        assertEquals(1, store.ledgerDays(maxDays = 1, now = today, timeZone = zone).size)
        // R12: asking for more than 10 days still gives 10 (the day-10 row stays out).
        assertEquals(days, store.ledgerDays(maxDays = 30, now = today, timeZone = zone))
    }

    @Test
    fun pruneDropsOldRawItemsAndLedgerRows() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        store.capture(item(text = "old raw"), now = now - 31 * day)
        store.capture(item(text = "very old ledger", pkg = "com.authy.authy"), now = now - 91 * day)
        store.capture(item(text = "fresh"), now = now)
        store.prune(now)
        assertEquals(1, store.db().rawItems().count())
        assertEquals("fresh", store.db().rawItems().newest(10).single().text)
        // The ledger keeps 90 days: the 31-day-old row stays, the 91-day-old drop goes.
        assertEquals(listOf(LedgerEntry.KEPT, LedgerEntry.KEPT), store.recentActivity(10).map { it.decision })
        // Pruning raw items does not touch unsent signals.
        assertEquals(2, store.pendingCount())
    }

    @Test
    fun pruneKeepsTheNewest5000Signals() = runBlocking {
        val db = store.db()
        db.withTransaction {
            for (i in 0 until OrbisStore.OUTBOX_CAP + 3) {
                db.signals().insert(PendingSignal("id-$i", Source.TEST, "test_item", now, "item $i", createdAt = now + i))
            }
        }
        store.prune(now)
        assertEquals(OrbisStore.OUTBOX_CAP, store.pendingCount())
        assertEquals(listOf("id-3", "id-4"), store.pendingBatch(2).map { it.id })
    }

    @Test
    fun lostKeystoreKeyStartsAFreshStoreInsteadOfCrashing() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        store.capture(item(text = "before the key was lost"))
        store.close()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KeyManager.ALIAS)

        store = OrbisStore(context)
        assertEquals(0, store.pendingCount())
        assertEquals(PrivacySettings(), store.settings())
        store.setSourceEnabled(Source.TEST, true)
        store.capture(item(text = "after"))
        reopen()
        assertEquals(1, store.pendingCount())
    }

    @Test
    fun aKeyThatDoesNotOpenTheFileStartsAFreshStore() = runBlocking {
        store.setSourceEnabled(Source.TEST, true)
        store.capture(item(text = "before"))
        store.close()
        val oldHeader = dbFile.readBytes().copyOf(16)
        // A valid wrapped key that is not this database's key.
        KeyManager(context).storeNewKey()

        store = OrbisStore(context)
        assertEquals(0, store.pendingCount())
        store.close()
        assertNotEquals(oldHeader.toList(), dbFile.readBytes().copyOf(16).toList())
        store = OrbisStore(context)
        assertEquals(0, store.pendingCount())
    }

    @Test
    fun rawKeyIsSqlcipherHexForm() {
        val key = ByteArray(32) { it.toByte() }
        val expected = "x'" + (0 until 32).joinToString("") { "%02x".format(it) } + "'"
        assertArrayEquals(expected.toByteArray(Charsets.US_ASCII), KeyManager.rawKey(key))
    }
}
