package app.orbis.core.store

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/** The SQLCipher-encrypted Room database behind [OrbisStore]. */
@Database(
    entities = [RawItem::class, PendingSignal::class, LedgerEntry::class, Kv::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class OrbisDatabase : RoomDatabase() {
    abstract fun rawItems(): RawItemDao
    abstract fun signals(): PendingSignalDao
    abstract fun ledger(): LedgerDao
    abstract fun kv(): KvDao

    companion object {
        const val NAME = "orbis.db"

        private val nativeLoaded by lazy { System.loadLibrary("sqlcipher") }

        /** Opens (lazily, on first use) the database keyed with [passphrase]. */
        fun build(context: Context, passphrase: ByteArray): OrbisDatabase {
            nativeLoaded
            val file = context.getDatabasePath(NAME)
            return Room.databaseBuilder(context.applicationContext, OrbisDatabase::class.java, file.absolutePath)
                .openHelperFactory(SupportOpenHelperFactory(passphrase))
                .build()
        }
    }
}
