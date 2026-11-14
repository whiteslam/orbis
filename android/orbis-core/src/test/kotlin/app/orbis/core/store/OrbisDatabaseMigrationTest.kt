package app.orbis.core.store

import androidx.sqlite.db.SupportSQLiteDatabase
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.lang.reflect.Proxy

/**
 * The 1 → 2 migration must build exactly the tables Room's exported schema 2.json describes, and
 * leave every version 1 table as it was. Runs the migration against a database that only records
 * its SQL (the JVM can't open SQLCipher); the instrumented OrbisStoreTest opens a real one.
 */
class OrbisDatabaseMigrationTest {
    private fun schema(version: Int): JSONObject {
        val file = File("schemas/app.orbis.core.store.OrbisDatabase/$version.json")
        return JSONObject(file.readText()).getJSONObject("database")
    }

    /** Each table's create statements (table, then its indices), as Room would run them. */
    private fun creates(database: JSONObject): Map<String, List<String>> {
        val entities = database.getJSONArray("entities")
        return (0 until entities.length()).associate { i ->
            val e = entities.getJSONObject(i)
            val table = e.getString("tableName")
            val indices = e.optJSONArray("indices")
            val sql = listOf(e.getString("createSql")) +
                (0 until (indices?.length() ?: 0)).map { indices!!.getJSONObject(it).getString("createSql") }
            table to sql.map { it.replace("\${TABLE_NAME}", table) }
        }
    }

    private fun recordMigration(): List<String> {
        val executed = mutableListOf<String>()
        val db = Proxy.newProxyInstance(
            SupportSQLiteDatabase::class.java.classLoader,
            arrayOf(SupportSQLiteDatabase::class.java),
        ) { _, method, args ->
            when (method.name) {
                "execSQL" -> { executed += args[0] as String; null }
                else -> throw UnsupportedOperationException(method.name)
            }
        } as SupportSQLiteDatabase
        OrbisDatabase.MIGRATION_1_2.migrate(db)
        return executed
    }

    @Test
    fun theMigrationAddsOnlyTheSeenNotificationTableAsSchemaTwoDescribesIt() {
        val v1 = schema(1)
        val v2 = schema(2)
        assertEquals(1, v1.getInt("version"))
        assertEquals(2, v2.getInt("version"))
        assertEquals(1, OrbisDatabase.MIGRATION_1_2.startVersion)
        assertEquals(2, OrbisDatabase.MIGRATION_1_2.endVersion)

        val before = creates(v1)
        val after = creates(v2)
        // Every version 1 table is unchanged; the only new one is seen_notification.
        assertEquals(before, after - "seen_notification")
        assertEquals(setOf("seen_notification"), after.keys - before.keys)
        assertEquals(after.getValue("seen_notification"), recordMigration())
    }
}
