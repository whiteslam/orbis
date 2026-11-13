package app.orbis.core.sync

import org.junit.Assert.assertEquals
import org.junit.Test

class SyncOutcomeTest {
    @Test fun twoHundredIsDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(200))
    @Test fun otherSuccessCodesAreDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(204))
    @Test fun fourOhOneIsRevoked() = assertEquals(SyncOutcome.Revoked, SyncOutcome.from(401))
    @Test fun fourOhThreeIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(403))

    // A bad batch is dropped, so one bad item cannot wedge the queue.
    @Test fun fourHundredIsDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(400))
    @Test fun fourThirteenIsDone() = assertEquals(SyncOutcome.Done, SyncOutcome.from(413))
    @Test fun fourTwentyNineIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(429))
    @Test fun fiveHundredIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(500))
    @Test fun fiveOhThreeIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(503))
    @Test fun aRedirectIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(302))
    @Test fun fourOhFourIsRetry() = assertEquals(SyncOutcome.Retry, SyncOutcome.from(404))
}
