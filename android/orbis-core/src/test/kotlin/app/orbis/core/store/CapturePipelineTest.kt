package app.orbis.core.store

import app.orbis.core.notify.NotificationFacts
import app.orbis.core.notify.NotificationReader
import app.orbis.core.rules.CapturedItem
import app.orbis.core.rules.DefaultBlocklist
import app.orbis.core.rules.Decision
import app.orbis.core.rules.DropReason
import app.orbis.core.rules.PrivacyRules
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CapturePipelineTest {
    /** Records every write, so a test can look at everything that would be stored. */
    private class FakePort : StorePort {
        val raw = mutableListOf<RawItem>()
        val signals = mutableListOf<PendingSignal>()
        val ledger = mutableListOf<LedgerEntry>()

        override suspend fun insertKept(raw: RawItem, signal: PendingSignal?, entry: LedgerEntry) {
            this.raw += raw
            if (signal != null) signals += signal
            ledger += entry
        }

        override suspend fun insertDropped(entry: LedgerEntry) {
            ledger += entry
        }

        /** Digests of notifications already kept, as the seen_notification table holds them. */
        val seen = mutableMapOf<String, Long>()

        override suspend fun seen(digest: String): Boolean = digest in seen

        override suspend fun markSeen(digest: String, at: Long) {
            seen.putIfAbsent(digest, at)
        }

        fun everything(): List<Any> = raw + signals + ledger
    }

    private val now = 1_800_000_000_000L
    private val occurred = now - 60_000L
    private val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val kind = Regex("^[a-z][a-z_]{0,39}$")

    private val settings = PrivacySettings(
        enabled = setOf(Source.TEST, Source.NOTIFICATIONS),
        blockedPackages = setOf("com.secret.bank"),
        blockedContacts = setOf(PrivacyRules.contactKey("Secret Sam")),
        blockedKeywords = listOf("hushproject"),
        pausedUntil = null,
    )
    private val paused = settings.copy(pausedUntil = now + 3_600_000L)

    private fun item(
        source: Source = Source.TEST,
        pkg: String? = null,
        contacts: List<String> = emptyList(),
        text: String,
        otherProfile: Boolean = false,
    ) = CapturedItem(source, pkg, contacts, text, occurred, otherProfile)

    // Spec §8 privacy regression test.
    @Test
    fun excludedItemsAreNeverStoredAndOnlyTheAllowedOneIsKeptMasked() = runBlocking {
        val port = FakePort()
        val pipeline = CapturePipeline(port)

        val cases = listOf(
            item(Source.NOTIFICATIONS, pkg = "com.secret.bank", text = "Blocked app says alpha") to settings,
            item(contacts = listOf("Secret Sam"), text = "Blocked contact says bravo") to settings,
            item(text = "Meeting about hushproject charlie") to settings,
            item(Source.CALENDAR, text = "Disabled source says delta") to settings,
            item(text = "Paused window says echo") to paused,
            item(text = "Work profile says foxtrot", otherProfile = true) to settings,
        )
        val decisions = cases.map { (it, s) -> pipeline.capture(it, s, now) }
        assertEquals(
            listOf(
                DropReason.BLOCKED_APP, DropReason.BLOCKED_CONTACT, DropReason.BLOCKED_KEYWORD,
                DropReason.SOURCE_OFF, DropReason.PAUSED, DropReason.OTHER_PROFILE,
            ).map { Decision.Drop(it) },
            decisions,
        )

        val allowed = item(pkg = "com.example.chat", contacts = listOf("Asha  Rao"), text = "Your OTP is 123456")
        assertEquals(Decision.Keep("Your OTP is [code]"), pipeline.capture(allowed, settings, now))

        // Exactly one raw item and one pending signal: the allowed one, masked.
        assertEquals(1, port.raw.size)
        val raw = port.raw.single()
        assertEquals(Source.TEST, raw.source)
        assertEquals("com.example.chat", raw.packageName)
        assertEquals("asha rao", raw.contactKeys)
        assertEquals("Your OTP is [code]", raw.text)
        assertEquals(occurred, raw.occurredAt)
        assertEquals(now, raw.capturedAt)

        assertEquals(1, port.signals.size)
        val signal = port.signals.single()
        assertTrue(signal.id, uuid.matches(signal.id))
        assertEquals(Source.TEST, signal.source)
        assertEquals("test_item", signal.kind)
        assertEquals(occurred, signal.occurredAt)
        assertEquals("Your OTP is [code]", signal.content)
        assertEquals(now, signal.createdAt)

        // Nothing stored anywhere carries a blocked package, contact, keyword or dropped text.
        val forbidden = listOf(
            "com.secret.bank", "secret sam", "hushproject", "123456",
            "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
        )
        val dump = port.everything().joinToString("\n") { it.toString() }.lowercase()
        for (word in forbidden) assertFalse("stored data contains '$word'", dump.contains(word))

        // The ledger has a row for every item; dropped rows carry only source, time and reason.
        assertEquals(7, port.ledger.size)
        val dropped = port.ledger.filter { it.decision == LedgerEntry.DROPPED }
        assertEquals(6, dropped.size)
        assertEquals(
            cases.zip(decisions).map { (case, d) ->
                LedgerEntry(at = now, source = case.first.source, decision = LedgerEntry.DROPPED, reason = (d as Decision.Drop).reason.name)
            },
            dropped,
        )
        val ledgerFields = LedgerEntry::class.java.declaredFields
            .filter { !java.lang.reflect.Modifier.isStatic(it.modifiers) }
            .map { it.name }
            .toSet()
        assertEquals(setOf("id", "at", "source", "decision", "reason"), ledgerFields)

        val kept = port.ledger.single { it.decision == LedgerEntry.KEPT }
        assertEquals(LedgerEntry(at = now, source = Source.TEST, decision = LedgerEntry.KEPT, reason = null), kept)
    }

    @Test
    fun contentIsCutTo4000CharsWithoutSplittingASurrogatePair() = runBlocking {
        val port = FakePort()
        val pipeline = CapturePipeline(port)
        val emoji = "😀"

        // The pair would straddle the cut: its high half is dropped.
        val straddle = "a".repeat(3999) + emoji + "tail"
        pipeline.capture(item(text = straddle), settings, now)
        assertEquals("a".repeat(3999), port.signals[0].content)
        assertEquals(straddle, port.raw[0].text)

        // The pair ends exactly at 4000: it is kept whole.
        val fits = "a".repeat(3998) + emoji + "tail"
        pipeline.capture(item(text = fits), settings, now)
        assertEquals("a".repeat(3998) + emoji, port.signals[1].content)
        assertEquals(4000, port.signals[1].content.length)

        // Short text is untouched.
        pipeline.capture(item(text = "Short $emoji text"), settings, now)
        assertEquals("Short $emoji text", port.signals[2].content)
    }

    @Test
    fun contentDropsNulAndReplacesLoneSurrogates() = runBlocking {
        val port = FakePort()
        val pipeline = CapturePipeline(port)
        pipeline.capture(item(text = "a\u0000b\uD800c\uDC00d\uD83D"), settings, now)
        assertEquals("ab\uFFFDc\uFFFDd\uFFFD", port.signals.single().content)
    }

    @Test
    fun keepWithEmptyContentStoresTheRawItemAndLedgerButNoSignal() = runBlocking {
        val port = FakePort()
        val pipeline = CapturePipeline(port)

        assertEquals(Decision.Keep(""), pipeline.capture(item(text = ""), settings, now))
        // Only a NUL: the cleaned content is empty too.
        pipeline.capture(item(text = "\u0000"), settings, now)

        assertEquals(2, port.raw.size)
        assertEquals(0, port.signals.size)
        assertEquals(listOf(LedgerEntry.KEPT, LedgerEntry.KEPT), port.ledger.map { it.decision })
        assertNull(port.ledger[0].reason)
    }

    @Test
    fun signalKindIsTestItemForTestAndValidForEverySource() = runBlocking {
        assertEquals("test_item", CapturePipeline.kindFor(Source.TEST))
        assertEquals("notifications_item", CapturePipeline.kindFor(Source.NOTIFICATIONS))
        for (s in Source.values()) assertTrue(CapturePipeline.kindFor(s), kind.matches(CapturePipeline.kindFor(s)))

        // The test source keeps its own kind; notifications are sorted instead (below).
        val port = FakePort()
        CapturePipeline(port).capture(item(Source.TEST, pkg = "com.example.chat", text = "hi"), settings, now)
        assertEquals("test_item", port.signals.single().kind)
    }

    private val payment = "Rs 2500.00 debited from A/c XX1234 at SWIGGY on 14-11-26"

    @Test
    fun aNotificationPaymentMakesARawItemAndATransactionSignal() = runBlocking {
        val port = FakePort()
        val d = CapturePipeline(port).capture(
            item(Source.NOTIFICATIONS, pkg = "com.example.sms", contacts = listOf("AX-HDFCBK"), text = payment),
            settings, now,
        )
        assertTrue(d is Decision.Keep)
        assertEquals(1, port.raw.size)
        assertEquals(Source.NOTIFICATIONS, port.raw.single().source)
        val signal = port.signals.single()
        assertEquals("transaction", signal.kind)
        assertEquals(Source.NOTIFICATIONS, signal.source)
        assertEquals(occurred, signal.occurredAt)
        assertEquals(now, signal.createdAt)
        assertTrue(signal.id, uuid.matches(signal.id))
        val json = org.json.JSONObject(signal.content)
        assertEquals("2500.00", json.getString("amount"))
        assertEquals("expense", json.getString("direction"))
        assertEquals(LedgerEntry(at = now, source = Source.NOTIFICATIONS, decision = LedgerEntry.KEPT, reason = null), port.ledger.single())
    }

    @Test
    fun anUnsortedNotificationMakesARawItemAndNoSignal() = runBlocking {
        val port = FakePort()
        val d = CapturePipeline(port).capture(item(Source.NOTIFICATIONS, pkg = "com.example.chat", text = "Asha: see you at 5"), settings, now)
        assertTrue(d is Decision.Keep)
        assertEquals(1, port.raw.size)
        assertEquals(0, port.signals.size)
        assertEquals(LedgerEntry.KEPT, port.ledger.single().decision)
    }

    @Test
    fun aOneTimeCodeIsDroppedAndLeavesOnlyALedgerEntry() = runBlocking {
        val port = FakePort()
        val d = CapturePipeline(port).capture(
            item(Source.NOTIFICATIONS, pkg = "com.example.sms", contacts = listOf("AX-HDFCBK"), text = "123456 is your OTP. Do not share it."),
            settings, now,
        )
        assertEquals(Decision.Drop(DropReason.ONE_TIME_CODE), d)
        assertEquals(0, port.raw.size)
        assertEquals(0, port.signals.size)
        assertEquals(
            listOf(LedgerEntry(at = now, source = Source.NOTIFICATIONS, decision = LedgerEntry.DROPPED, reason = "ONE_TIME_CODE")),
            port.ledger,
        )
        assertFalse(port.everything().joinToString("\n") { it.toString() }.contains("123456"))
    }

    @Test
    fun aBlockedSendersPaymentAlertWritesNothingButTheLedger() = runBlocking {
        val port = FakePort()
        val s = settings.copy(blockedContacts = setOf(PrivacyRules.contactKey("AX-HDFCBK")))
        val d = CapturePipeline(port).capture(
            item(Source.NOTIFICATIONS, pkg = "com.example.sms", contacts = listOf("AX-HDFCBK"), text = payment),
            s, now,
        )
        assertEquals(Decision.Drop(DropReason.BLOCKED_CONTACT), d)
        assertEquals(0, port.raw.size)
        assertEquals(0, port.signals.size)
        assertEquals(listOf("BLOCKED_CONTACT"), port.ledger.map { it.reason })
    }

    // Spec §2 anti-goal 1: a blocked contact's notifications are never read. These go through the
    // reader, as the listener does, so the contacts are the ones a real notification gives.
    private fun notification(pkg: String, title: String?, text: String?, handles: List<String> = emptyList()) =
        NotificationReader.toItem(
            NotificationFacts("k", pkg, title, text, null, occurred, occurred, false, false, false, handles),
            "app.orbis.android",
        )!!

    private fun assertOnlyTheLedger(port: FakePort, d: Decision, vararg secrets: String) {
        assertEquals(Decision.Drop(DropReason.BLOCKED_CONTACT), d)
        assertEquals(0, port.raw.size)
        assertEquals(0, port.signals.size)
        assertEquals(
            listOf(LedgerEntry(at = now, source = Source.NOTIFICATIONS, decision = LedgerEntry.DROPPED, reason = "BLOCKED_CONTACT")),
            port.ledger,
        )
        val dump = port.everything().joinToString("\n") { it.toString() }.lowercase()
        for (s in secrets) assertFalse("stored data contains '$s'", dump.contains(s.lowercase()))
    }

    @Test
    fun aBlockedNumbersMissedCallWritesNothingButTheLedger() = runBlocking {
        val port = FakePort()
        val s = settings.copy(blockedContacts = setOf(PrivacyRules.contactKey("98765 43210")))
        val d = CapturePipeline(port).capture(
            notification("com.google.android.dialer", "Missed call", "+91 98765 43210"), s, now,
        )
        assertOnlyTheLedger(port, d, "98765", "3210", "missed")
    }

    @Test
    fun aBlockedSavedNamesWhatsAppMessageWritesNothingButTheLedger() = runBlocking {
        val port = FakePort()
        val s = settings.copy(blockedContacts = setOf(PrivacyRules.contactKey("Asha")))
        val d = CapturePipeline(port).capture(notification("com.whatsapp", "Asha", "See you at 6"), s, now)
        assertOnlyTheLedger(port, d, "asha", "see you")
    }

    @Test
    fun aBlockedSendersGroupMessageWritesNothingButTheLedger() = runBlocking {
        val s = settings.copy(blockedContacts = setOf(PrivacyRules.contactKey("Asha")))
        // Older WhatsApp: "Group: Sender" in the title.
        val titled = FakePort()
        assertOnlyTheLedger(
            titled,
            CapturePipeline(titled).capture(notification("com.whatsapp", "Family: Asha", "Dinner at 8"), s, now),
            "asha", "dinner",
        )
        // Newer: the group as the title, the sender in the message list (the listener's handles).
        val messaging = FakePort()
        assertOnlyTheLedger(
            messaging,
            CapturePipeline(messaging).capture(notification("com.whatsapp", "Family", "Dinner at 8", listOf("Asha")), s, now),
            "asha", "dinner",
        )
    }

    @Test
    fun aBlockedCallersMissedCallFromOneLineWritesNothingButTheLedger() = runBlocking {
        val port = FakePort()
        val s = settings.copy(blockedContacts = setOf(PrivacyRules.contactKey("Asha")))
        val d = CapturePipeline(port).capture(notification("com.google.android.dialer", "Missed call from Asha", null), s, now)
        assertOnlyTheLedger(port, d, "asha")
    }

    @Test
    fun aBlockedAppsPaymentAlertWritesNothingButTheLedger() = runBlocking {
        val port = FakePort()
        val s = settings.copy(blockedPackages = DefaultBlocklist.PACKAGES)
        val d = CapturePipeline(port).capture(
            item(Source.NOTIFICATIONS, pkg = "com.hdfcbank.android.now", text = payment),
            s, now,
        )
        assertEquals(Decision.Drop(DropReason.BLOCKED_APP), d)
        assertEquals(0, port.raw.size)
        assertEquals(0, port.signals.size)
        assertEquals(listOf("BLOCKED_APP"), port.ledger.map { it.reason })
    }

    @Test
    fun theTestSourceStillMakesTestItemSignals() = runBlocking {
        val port = FakePort()
        // Payment-shaped text from the test source is not sorted: it keeps "test_item".
        CapturePipeline(port).capture(item(Source.TEST, text = payment), settings, now)
        val signal = port.signals.single()
        assertEquals("test_item", signal.kind)
        assertEquals(CapturePipeline.signalContent(PrivacyRules.decide(item(Source.TEST, text = payment), settings, now).let { (it as Decision.Keep).maskedText }), signal.content)
    }

    @Test
    fun everySignalGetsItsOwnLowercaseUuid() = runBlocking {
        val port = FakePort()
        val pipeline = CapturePipeline(port)
        repeat(3) { pipeline.capture(item(text = "hello $it"), settings, now) }
        val ids = port.signals.map { it.id }
        assertEquals(3, ids.toSet().size)
        for (id in ids) assertTrue(id, uuid.matches(id))
    }

    // Review Focus #1: after a reboot, apps post their unread notifications again. The store
    // remembers each kept notification's digest, so an unread bank text is one transaction.
    private val bankText = "AX-HDFCBK\n$payment"
    private val digest = "a".repeat(64)

    @Test
    fun aNotificationPostedAgainIsReadOnce() = runBlocking {
        val port = FakePort()
        val pipeline = CapturePipeline(port)
        val bank = item(Source.NOTIFICATIONS, pkg = "com.google.android.apps.messaging", contacts = listOf("AX-HDFCBK"), text = bankText)

        assertTrue(pipeline.captureOnce(bank, digest, settings, now) is Decision.Keep)
        assertEquals(mapOf(digest to now), port.seen)
        // A new pipeline (a new process) over the same store: nothing more is written.
        assertNull(CapturePipeline(port).captureOnce(bank, digest, settings, now + 1))
        assertEquals(1, port.raw.size)
        assertEquals(1, port.signals.size)
        assertEquals(1, port.ledger.size)
        // A different notification is read.
        assertTrue(pipeline.captureOnce(bank, "b".repeat(64), settings, now) is Decision.Keep)
        assertEquals(2, port.signals.size)
    }

    @Test
    fun aNotificationsSignalIdComesFromItsDigest() = runBlocking {
        val bank = item(Source.NOTIFICATIONS, pkg = "com.google.android.apps.messaging", text = bankText)
        val first = FakePort().also { CapturePipeline(it).captureOnce(bank, digest, settings, now) }.signals.single()
        // Even if the phone forgot the digest, the same notification gets the same id, so the
        // server's "on conflict do nothing" keeps one.
        val again = FakePort().also { CapturePipeline(it).captureOnce(bank, digest, settings, now + 5) }.signals.single()
        assertEquals(first.id, again.id)
        assertEquals(CapturePipeline.signalIdFor(digest), first.id)
        assertTrue(first.id, uuid.matches(first.id))
        assertNotEquals(first.id, CapturePipeline.signalIdFor("b".repeat(64)))
        // Without a digest (the test source), every signal still gets a fresh random id.
        val port = FakePort()
        repeat(2) { CapturePipeline(port).capture(item(text = "same words"), settings, now) }
        assertEquals(2, port.signals.map { it.id }.toSet().size)
    }

    @Test
    fun aDroppedNotificationLeavesNoDigest() = runBlocking {
        val port = FakePort()
        val pipeline = CapturePipeline(port)
        val blocked = settings.copy(blockedContacts = setOf(PrivacyRules.contactKey("AX-HDFCBK")))
        val bank = item(Source.NOTIFICATIONS, pkg = "com.google.android.apps.messaging", contacts = listOf("AX-HDFCBK"), text = bankText)
        assertEquals(Decision.Drop(DropReason.BLOCKED_CONTACT), pipeline.captureOnce(bank, digest, blocked, now))
        val code = item(Source.NOTIFICATIONS, pkg = "com.google.android.apps.messaging", text = "123456 is your OTP")
        assertEquals(Decision.Drop(DropReason.ONE_TIME_CODE), pipeline.captureOnce(code, "c".repeat(64), settings, now))
        // Nothing about a dropped item is kept, not even its digest.
        assertTrue(port.seen.isEmpty())
        assertEquals(0, port.raw.size)
    }
}
