package app.orbis.core.notify

import app.orbis.core.rules.Source
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationReaderTest {
    private val own = "app.orbis.android"

    private fun facts(
        key: String = "k1",
        packageName: String = "com.whatsapp",
        title: String? = "Asha",
        text: String? = "See you at 6",
        bigText: String? = null,
        postTime: Long = 1_000L,
        ongoing: Boolean = false,
        groupSummary: Boolean = false,
        otherProfile: Boolean = false,
    ) = NotificationFacts(key, packageName, title, text, bigText, postTime, ongoing, groupSummary, otherProfile)

    @Test fun `own package is skipped`() {
        assertNull(NotificationReader.toItem(facts(packageName = own), own))
        assertNotNull(NotificationReader.toItem(facts(), own))
    }

    @Test fun `ongoing and group summaries are skipped`() {
        assertNull(NotificationReader.toItem(facts(ongoing = true), own))
        assertNull(NotificationReader.toItem(facts(groupSummary = true), own))
    }

    @Test fun `a blank title and text is skipped`() {
        assertNull(NotificationReader.toItem(facts(title = null, text = null), own))
        assertNull(NotificationReader.toItem(facts(title = " ", text = "", bigText = null), own))
    }

    @Test fun `title and big text are joined`() {
        val item = NotificationReader.toItem(facts(title = "Asha", text = "short", bigText = "the long version", postTime = 42L), own)!!
        assertEquals("Asha\nthe long version", item.text)
        assertEquals(listOf("Asha"), item.contacts)
        assertEquals(42L, item.occurredAt)
        assertEquals(Source.NOTIFICATIONS, item.source)
        assertEquals("com.whatsapp", item.packageName)
        assertEquals("Asha\nshort", NotificationReader.toItem(facts(bigText = null, text = "short"), own)!!.text)
    }

    @Test fun `the same key and text is read once`() {
        val keys = RecentKeys()
        assertTrue(keys.firstTime("k1", "hello"))
        assertFalse(keys.firstTime("k1", "hello"))
        assertTrue(keys.firstTime("k1", "hello again"))
        assertTrue(keys.firstTime("k2", "hello"))
    }

    @Test fun `the oldest key is forgotten past the capacity`() {
        val keys = RecentKeys(capacity = 2)
        keys.firstTime("a", "x"); keys.firstTime("b", "x"); keys.firstTime("c", "x")
        assertTrue(keys.firstTime("a", "x"))
    }

    @Test fun `another profile is marked`() {
        assertTrue(NotificationReader.toItem(facts(otherProfile = true), own)!!.fromOtherProfile)
        assertFalse(NotificationReader.toItem(facts(otherProfile = false), own)!!.fromOtherProfile)
    }
}
