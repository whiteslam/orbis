package app.orbis.core.store

/** The writes [CapturePipeline] makes, so the pipeline can be tested on the JVM with a fake. */
interface StorePort {
    /** Writes a kept item, its signal (null when its content is empty) and its ledger row, together. */
    suspend fun insertKept(raw: RawItem, signal: PendingSignal?, entry: LedgerEntry)

    /** Writes the ledger row of a dropped item. Nothing else about the item is stored. */
    suspend fun insertDropped(entry: LedgerEntry)
}
