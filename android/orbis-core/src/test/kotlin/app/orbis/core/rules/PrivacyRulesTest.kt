package app.orbis.core.rules

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivacyRulesTest {
    private val now = 1_000_000L

    private fun item(
        source: Source = Source.NOTIFICATIONS,
        packageName: String? = "com.example.chat",
        contacts: List<String> = emptyList(),
        text: String = "hello there",
        fromOtherProfile: Boolean = false,
    ) = CapturedItem(source, packageName, contacts, text, occurredAt = now, fromOtherProfile = fromOtherProfile)

    private fun on(vararg sources: Source, base: PrivacySettings = PrivacySettings()) =
        base.copy(enabled = sources.toSet())

    private fun decide(item: CapturedItem, settings: PrivacySettings) =
        PrivacyRules.decide(item, settings, now)

    private fun dropped(reason: DropReason) = Decision.Drop(reason)

    @Test fun defaultSettingsDropEverythingAsSourceOff() {
        assertEquals(dropped(DropReason.SOURCE_OFF), decide(item(), PrivacySettings()))
    }

    @Test fun enabledSourceKeeps() {
        assertEquals(Decision.Keep("hello there"), decide(item(), on(Source.NOTIFICATIONS)))
    }

    @Test fun otherProfileDrops() {
        val s = on(Source.NOTIFICATIONS)
        assertEquals(dropped(DropReason.OTHER_PROFILE), decide(item(fromOtherProfile = true), s))
    }

    @Test fun pausedDrops() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(pausedUntil = now + 1))
        assertEquals(dropped(DropReason.PAUSED), decide(item(), s))
    }

    @Test fun sourceOffDropsWhenOtherSourceIsOn() {
        assertEquals(dropped(DropReason.SOURCE_OFF), decide(item(source = Source.CALENDAR), on(Source.NOTIFICATIONS)))
    }

    @Test fun blockedAppDrops() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(blockedPackages = setOf("com.example.chat")))
        assertEquals(dropped(DropReason.BLOCKED_APP), decide(item(), s))
    }

    @Test fun defaultBlocklistDropsTheAuthenticator() {
        val s = on(Source.NOTIFICATIONS)
        assertEquals(
            dropped(DropReason.BLOCKED_APP),
            decide(item(packageName = "com.google.android.apps.authenticator2"), s),
        )
    }

    @Test fun nullPackageIsNotBlocked() {
        assertTrue(decide(item(packageName = null), on(Source.NOTIFICATIONS)) is Decision.Keep)
    }

    @Test fun blockedContactDrops() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(blockedContacts = setOf("mum")))
        assertEquals(dropped(DropReason.BLOCKED_CONTACT), decide(item(contacts = listOf("Mum")), s))
    }

    @Test fun blockedContactMatchesAcrossPhoneFormats() {
        val key = PrivacyRules.contactKey("+91 98765-43210")
        assertEquals("9876543210", key)
        val s = on(Source.CALLS, base = PrivacySettings(blockedContacts = setOf(key)))
        assertEquals(
            dropped(DropReason.BLOCKED_CONTACT),
            decide(item(source = Source.CALLS, contacts = listOf("9876543210")), s),
        )
    }

    @Test fun contactKeyKeepsLast10DigitsOfLongNumbers() {
        assertEquals("9876543210", PrivacyRules.contactKey("0091 (98765) 43210"))
    }

    @Test fun contactKeyKeepsShortNumbersWholeAsLowercaseText() {
        assertEquals("123456", PrivacyRules.contactKey(" 123456 "))
    }

    @Test fun contactKeyLowercasesTrimsAndCollapsesSpaces() {
        assertEquals("jane doe", PrivacyRules.contactKey("  Jane   DOE "))
    }

    @Test fun blockedKeywordMatchesTextAnyCase() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(blockedKeywords = listOf("Secret")))
        assertEquals(dropped(DropReason.BLOCKED_KEYWORD), decide(item(text = "this is a SECRET plan"), s))
    }

    @Test fun blockedKeywordMatchesContactNamesAnyCase() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(blockedKeywords = listOf("boss")))
        assertEquals(dropped(DropReason.BLOCKED_KEYWORD), decide(item(contacts = listOf("My BOSS")), s))
    }

    @Test fun blankKeywordsAreIgnored() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(blockedKeywords = listOf("", "  ")))
        assertTrue(decide(item(), s) is Decision.Keep)
    }

    @Test fun otherProfileWinsOverPaused() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(pausedUntil = PAUSED_FOREVER))
        assertEquals(dropped(DropReason.OTHER_PROFILE), decide(item(fromOtherProfile = true), s))
    }

    @Test fun pausedWinsOverSourceOff() {
        val s = PrivacySettings(pausedUntil = PAUSED_FOREVER)
        assertEquals(dropped(DropReason.PAUSED), decide(item(), s))
    }

    @Test fun sourceOffWinsOverBlockedApp() {
        val s = PrivacySettings(blockedPackages = setOf("com.example.chat"))
        assertEquals(dropped(DropReason.SOURCE_OFF), decide(item(), s))
    }

    @Test fun blockedAppWinsOverBlockedContact() {
        val s = on(
            Source.NOTIFICATIONS,
            base = PrivacySettings(blockedPackages = setOf("com.example.chat"), blockedContacts = setOf("mum")),
        )
        assertEquals(dropped(DropReason.BLOCKED_APP), decide(item(contacts = listOf("mum")), s))
    }

    @Test fun blockedContactWinsOverBlockedKeyword() {
        val s = on(
            Source.NOTIFICATIONS,
            base = PrivacySettings(blockedContacts = setOf("mum"), blockedKeywords = listOf("hello")),
        )
        assertEquals(dropped(DropReason.BLOCKED_CONTACT), decide(item(contacts = listOf("mum")), s))
    }

    @Test fun pausedForeverDrops() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(pausedUntil = PAUSED_FOREVER))
        assertEquals(dropped(DropReason.PAUSED), decide(item(), s))
    }

    @Test fun expiredPauseKeeps() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(pausedUntil = now - 1))
        assertTrue(decide(item(), s) is Decision.Keep)
    }

    @Test fun pauseEndingExactlyNowKeeps() {
        val s = on(Source.NOTIFICATIONS, base = PrivacySettings(pausedUntil = now))
        assertTrue(decide(item(), s) is Decision.Keep)
    }

    @Test fun keepIsMasked() {
        val result = decide(item(text = "Your OTP is 482913"), on(Source.NOTIFICATIONS))
        assertEquals(Decision.Keep("Your OTP is [code]"), result)
    }

    @Test fun defaultBlocklistHasTheAuthenticator() {
        assertTrue("com.google.android.apps.authenticator2" in DefaultBlocklist.PACKAGES)
    }

    @Test fun sourceWireNamesRoundTrip() {
        assertEquals(
            listOf("test", "notifications", "calendar", "contacts", "calls", "health", "usage", "phone_state", "location"),
            Source.values().map { it.wire },
        )
        Source.values().forEach { assertEquals(it, Source.fromWire(it.wire)) }
        assertEquals(null, Source.fromWire("sms"))
    }
}
