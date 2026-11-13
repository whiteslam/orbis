package app.orbis.core.service

import app.orbis.core.rules.PAUSED_FOREVER
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServicePolicyTest {
    private val now = 1_000_000L
    private val one = PrivacySettings(enabled = setOf(Source.TEST))

    @Test fun noCredentialIsFalse() = assertFalse(ServicePolicy.shouldRun(one, now, hasCredential = false))
    @Test fun noSourcesIsFalse() = assertFalse(ServicePolicy.shouldRun(PrivacySettings(), now, hasCredential = true))
    @Test fun pausedIsFalse() = assertFalse(ServicePolicy.shouldRun(one.copy(pausedUntil = now + 1), now, true))
    @Test fun pausedForeverIsFalse() = assertFalse(ServicePolicy.shouldRun(one.copy(pausedUntil = PAUSED_FOREVER), now, true))
    @Test fun aPauseInThePastIsTrue() = assertTrue(ServicePolicy.shouldRun(one.copy(pausedUntil = now - 1), now, true))
    @Test fun aPauseEndingExactlyNowIsTrue() = assertTrue(ServicePolicy.shouldRun(one.copy(pausedUntil = now), now, true))
    @Test fun oneSourceWithACredentialIsTrue() = assertTrue(ServicePolicy.shouldRun(one, now, true))

    @Test fun resumeAtIsTheFinitePauseEnd() = assertEquals(now + 5, ServicePolicy.resumeAt(one.copy(pausedUntil = now + 5), now))
    @Test fun resumeAtIsNullWhenNotPaused() = assertNull(ServicePolicy.resumeAt(one, now))
    @Test fun resumeAtIsNullForAPastPause() = assertNull(ServicePolicy.resumeAt(one.copy(pausedUntil = now - 1), now))
    @Test fun resumeAtIsNullWhenPausedForever() = assertNull(ServicePolicy.resumeAt(one.copy(pausedUntil = PAUSED_FOREVER), now))

    @Test fun labelsListEnabledSourcesInOrder() {
        val s = PrivacySettings(enabled = setOf(Source.CALENDAR, Source.TEST, Source.NOTIFICATIONS))
        assertEquals("Reading: Test source, Notifications, Calendar", ServicePolicy.notificationText(s))
    }
    @Test fun testSourceLabel() = assertEquals("Reading: Test source", ServicePolicy.notificationText(one))
    @Test fun everySourceHasALabel() {
        val all = PrivacySettings(enabled = Source.values().toSet())
        assertEquals(9, ServicePolicy.notificationText(all).removePrefix("Reading: ").split(", ").size)
    }
}
