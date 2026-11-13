package app.orbis.core.store

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.orbis.core.rules.Source

@Dao
interface RawItemDao {
    @Insert
    suspend fun insert(item: RawItem): Long

    @Query("DELETE FROM raw_item WHERE source = :source")
    suspend fun deleteBySource(source: Source)

    @Query("DELETE FROM raw_item WHERE capturedAt < :cutoff")
    suspend fun deleteCapturedBefore(cutoff: Long)

    @Query("DELETE FROM raw_item")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM raw_item")
    suspend fun count(): Int

    @Query("SELECT * FROM raw_item ORDER BY capturedAt DESC, id DESC LIMIT :limit")
    suspend fun newest(limit: Int): List<RawItem>
}

@Dao
interface PendingSignalDao {
    @Insert
    suspend fun insert(signal: PendingSignal)

    /** Oldest first, so the outbox drains in order. */
    @Query("SELECT * FROM pending_signal ORDER BY createdAt ASC, rowid ASC LIMIT :limit")
    suspend fun oldest(limit: Int): List<PendingSignal>

    @Query("DELETE FROM pending_signal WHERE id IN (:ids)")
    suspend fun deleteIds(ids: List<String>)

    @Query("DELETE FROM pending_signal WHERE source = :source")
    suspend fun deleteBySource(source: Source)

    @Query("DELETE FROM pending_signal")
    suspend fun deleteAll()

    /** Keeps only the [keep] newest signals. */
    @Query(
        "DELETE FROM pending_signal WHERE rowid IN " +
            "(SELECT rowid FROM pending_signal ORDER BY createdAt DESC, rowid DESC LIMIT -1 OFFSET :keep)",
    )
    suspend fun trim(keep: Int)

    @Query("SELECT COUNT(*) FROM pending_signal")
    suspend fun count(): Int
}

@Dao
interface LedgerDao {
    @Insert
    suspend fun insert(entry: LedgerEntry)

    @Query("SELECT * FROM ledger_entry WHERE at >= :from AND at < :until ORDER BY at ASC, id ASC")
    suspend fun between(from: Long, until: Long): List<LedgerEntry>

    @Query("SELECT * FROM ledger_entry ORDER BY at DESC, id DESC LIMIT :limit")
    suspend fun newest(limit: Int): List<LedgerEntry>

    @Query("DELETE FROM ledger_entry WHERE at < :cutoff")
    suspend fun deleteBefore(cutoff: Long)

    @Query("DELETE FROM ledger_entry WHERE source = :source")
    suspend fun deleteBySource(source: Source)

    @Query("DELETE FROM ledger_entry")
    suspend fun deleteAll()
}

@Dao
interface KvDao {
    @Query("SELECT value FROM kv WHERE `key` = :key")
    suspend fun get(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entry: Kv)

    @Query("DELETE FROM kv WHERE `key` = :key")
    suspend fun delete(key: String)

    @Query("DELETE FROM kv")
    suspend fun deleteAll()
}
