package app.orbis.core.store

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/**
 * The SQLCipher-encrypted Room database behind [OrbisStore]. A new table must also be emptied in
 * [OrbisStore.wipeIf], which deletes row by row (clearAllTables can't run inside its transaction).
 * A new version needs a migration (never a destructive fallback: it would lose queued signals)
 * and its exported schema in `schemas/`; OrbisDatabaseMigrationTest checks the two agree.
 */
@Database(
    entities = [RawItem::class, PendingSignal::class, LedgerEntry::class, Kv::class, SeenNotification::class],
    version = 2,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class OrbisDatabase : RoomDatabase() {
    abstract fun rawItems(): RawItemDao
    abstract fun signals(): PendingSignalDao
    abstract fun ledger(): LedgerDao
    abstract fun kv(): KvDao
    abstract fun seen(): SeenNotificationDao

    companion object {
        const val NAME = "orbis.db"

        /** Version 2 adds seen_notification, so a notification posted again is read once. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `seen_notification` " +
                        "(`digest` TEXT NOT NULL, `at` INTEGER NOT NULL, PRIMARY KEY(`digest`))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_seen_notification_at` ON `seen_notification` (`at`)")
            }
        }

        private val nativeLoaded by lazy { System.loadLibrary("sqlcipher") }

        /** Opens (lazily, on first use) the database keyed with [passphrase]. */
        fun build(context: Context, passphrase: ByteArray): OrbisDatabase {
            nativeLoaded
            val file = context.getDatabasePath(NAME)
            return Room.databaseBuilder(context.applicationContext, OrbisDatabase::class.java, file.absolutePath)
                .openHelperFactory(SupportOpenHelperFactory(passphrase))
                .addMigrations(MIGRATION_1_2)
                .build()
        }
    }
}
