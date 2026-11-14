package app.orbis.core.store

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import app.orbis.core.rules.Source

/**
 * A kept item, as it stays on the phone: masked text only. [contactKeys] holds the
 * `PrivacyRules.contactKey` of each contact, one per line. Pruned after 30 days.
 */
@Entity(tableName = "raw_item", indices = [Index("source"), Index("capturedAt")])
data class RawItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val source: Source,
    val packageName: String?,
    val contactKeys: String,
    val text: String,
    val occurredAt: Long,
    val capturedAt: Long,
)

/**
 * A signal waiting to be sent (the outbox). [id] is a lowercase UUID; [content] is the masked
 * text cleaned for the server and cut to 4,000 UTF-16 units, never empty. Times are epoch ms.
 */
@Entity(tableName = "pending_signal", indices = [Index("source"), Index("createdAt")])
data class PendingSignal(
    @PrimaryKey val id: String,
    val source: Source,
    val kind: String,
    val occurredAt: Long,
    val content: String,
    val createdAt: Long,
)

/**
 * One row per decision. A dropped item's row carries only its source, time and reason
 * (a `DropReason` name), never a package, contact or text.
 */
@Entity(tableName = "ledger_entry", indices = [Index("at")])
data class LedgerEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Long,
    val source: Source,
    val decision: String,
    val reason: String?,
) {
    companion object {
        const val KEPT = "kept"
        const val DROPPED = "dropped"
        const val ACTION = "action"
    }
}

/** Small values: settings, the device credential, last sync and so on. */
@Entity(tableName = "kv")
data class Kv(
    @PrimaryKey val key: String,
    val value: String,
) {
    // Values include the device credential: never print them.
    override fun toString(): String = "Kv(key=$key, value=<hidden>)"
}

/**
 * A notification already kept: its `NotificationReader.digest` (64 hex characters, no words) and
 * when it was captured (epoch ms). Apps post unread notifications again after a reboot; this is
 * how the same one is read once. Written only for kept items, pruned with raw items (30 days).
 * Added in database version 2.
 */
@Entity(tableName = "seen_notification", indices = [Index("at")])
data class SeenNotification(
    @PrimaryKey val digest: String,
    val at: Long,
)

/** Sources are stored by their wire name, so renaming an enum constant can't break old rows. */
class Converters {
    @TypeConverter
    fun sourceToWire(source: Source): String = source.wire

    @TypeConverter
    fun wireToSource(wire: String): Source =
        Source.fromWire(wire) ?: throw IllegalStateException("Unknown source in the store: $wire")
}
