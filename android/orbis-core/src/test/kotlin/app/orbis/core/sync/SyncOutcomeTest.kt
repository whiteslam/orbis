package app.orbis.core.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncOutcomeTest {
    private val ok = "{\"accepted\":2,\"duplicate\":0,\"refused\":1}"

    // R20: a 2xx is Done only with the server's JSON counts.
    @Test fun twoHundredWithCountsIsDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(200, ok))
    @Test fun otherSuccessCodesWithCountsAreDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(201, ok))
    @Test fun twoHundredWithHtmlIsRetry() =
        assertEquals(SyncOutcome.Retry, SyncOutcome.from(200, "<!DOCTYPE html><html><body>Orbis</body></html>"))
    @Test fun twoHundredWithAMissingFieldIsRetry() =
        assertEquals(SyncOutcome.Retry, SyncOutcome.from(200, "{\"accepted\":2,\"duplicate\":0}"))
    @Test fun twoHundredWithANonNumericFieldIsRetry() =
        assertEquals(SyncOutcome.Retry, SyncOutcome.from(200, "{\"accepted\":\"2\",\"duplicate\":0,\"refused\":0}"))
    @Test fun twoHundredWithAJsonArrayIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(200, "[1,2,3]"))
    @Test fun twoOhFourIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(204, null))
    @Test fun twoHundredWithAnEmptyBodyIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(200, ""))
    @Test fun twoHundredWithNoBodyIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(200, null))

    @Test fun countedReplyNeedsAllThreeNumbers() {
        assertTrue(SyncOutcome.isCountedReply(ok))
        assertTrue(SyncOutcome.isCountedReply("{\"accepted\":0,\"duplicate\":0,\"refused\":0,\"extra\":true}"))
        assertFalse(SyncOutcome.isCountedReply("{\"accepted\":null,\"duplicate\":0,\"refused\":0}"))
        assertFalse(SyncOutcome.isCountedReply("not json"))
    }

    // The status cases are unchanged; the body doesn't matter for them.
    @Test fun fourOhOneIsRevoked() = assertEquals(SyncOutcome.Revoked, SyncOutcome.from(401, null))
    @Test fun fourOhOneWithHtmlIsStillRevoked() = assertEquals(SyncOutcome.Revoked, SyncOutcome.from(401, "<html></html>"))
    @Test fun fourOhThreeIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(403, null))

    // A bad batch is dropped, so one bad item cannot wedge the queue.
    @Test fun fourHundredIsDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(400, "{\"error\":\"x\"}"))
    @Test fun fourThirteenIsDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(413, null))
    @Test fun fourTwentyNineIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(429, null))
    @Test fun fiveHundredIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(500, null))
    @Test fun fiveOhThreeIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(503, ok))
    @Test fun aRedirectIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(302, null))
    @Test fun fourOhFourIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(404, null))
}
