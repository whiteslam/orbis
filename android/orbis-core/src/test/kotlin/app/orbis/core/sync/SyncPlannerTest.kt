package app.orbis.core.sync

import app.orbis.core.rules.Source
import app.orbis.core.store.PendingSignal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncPlannerTest {
    private fun signals(n: Int, content: String = "hello") = (0 until n).map {
        PendingSignal("id-$it", Source.TEST, "test_item", 1_000L + it, content, 1_000L + it)
    }

    @Test
    fun twoHundredFiftyItemsMakeBatchesOf100100And50() {
        assertEquals(listOf(100, 100, 50), SyncPlanner.batches(signals(250)).map { it.size })
    }

    @Test
    fun orderIsKept() {
        val all = signals(250)
        assertEquals(all.map { it.id }, SyncPlanner.batches(all).flatten().map { it.id })
    }

    @Test
    fun anEmptyListGivesNoBatches() {
        assertTrue(SyncPlanner.batches(emptyList()).isEmpty())
    }

    @Test
    fun itemsOverTheByteCapSplitEarlier() {
        // 40 items of 4,000 characters are ~160 KB: under the count cap, over a 100 KB byte cap.
        val big = signals(40, "x".repeat(4000))
        val batches = SyncPlanner.batches(big, maxCount = 100, maxBytes = 100_000)
        assertTrue(batches.size > 1)
        assertEquals(40, batches.sumOf { it.size })
        for (b in batches) assertTrue(b.sumOf { SyncPayload.signalBytes(it) } <= 100_000)
    }

    @Test
    fun theDefaultByteCapKeepsARequestUnderTheServersLimit() {
        // 4,000 UTF-16 units of 4-byte characters, the largest content a signal can have.
        val big = signals(100, "😀".repeat(2000))
        val batches = SyncPlanner.batches(big)
        assertTrue(batches.size > 1)
        for (b in batches) {
            val body = SyncPayload.toJson(SyncMeta("0.1.0", "t".repeat(4096)), emptyList(), b, emptyList())
            assertTrue(body.toByteArray(Charsets.UTF_8).size < 256 * 1024)
        }
    }

    @Test
    fun aSingleItemOverTheCapStillGetsItsOwnBatch() {
        val one = signals(1, "x".repeat(4000))
        assertEquals(listOf(1), SyncPlanner.batches(one, maxCount = 100, maxBytes = 10).map { it.size })
    }
}
