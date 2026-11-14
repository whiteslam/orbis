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
        handles: List<String> = emptyList(),
    ) = NotificationFacts(key, packageName, title, text, bigText, postTime, ongoing, groupSummary, otherProfile, handles)

    private fun contacts(f: NotificationFacts) = NotificationReader.toItem(f, own)!!.contacts

    // The caller of a phone app's missed call is in the text, not the title.
    @Test fun `a dialer's missed call lists the caller as a contact`() {
        val number = facts(packageName = "com.google.android.dialer", title = "Missed call", text = "+91 98765 43210")
        assertEquals(listOf("Missed call", "+91 98765 43210"), contacts(number))
        val name = facts(packageName = "com.samsung.android.dialer", title = "Missed call", text = "Asha\nMobile")
        assertTrue(contacts(name).contains("Asha"))
    }

    @Test fun `missed call from a name on one line gives the name`() {
        val f = facts(packageName = "com.google.android.dialer", title = "Missed call from Asha", text = null)
        assertTrue(contacts(f).contains("Asha"))
        val g = facts(packageName = "com.android.dialer", title = "Missed call", text = "2 missed calls from +91 98765 43210")
        assertTrue(contacts(g).contains("+91 98765 43210"))
    }

    @Test fun `a chat message's words are not contacts`() {
        assertEquals(listOf("Asha"), contacts(facts(packageName = "com.whatsapp", title = "Asha", text = "Call 98765 43210 later")))
    }

    @Test fun `a group title gives the sender after the colon`() {
        assertEquals(listOf("Family: Asha", "Asha"), contacts(facts(title = "Family: Asha", text = "Dinner at 8")))
        assertEquals(listOf("Family (3 messages): Asha", "Asha"), contacts(facts(title = "Family (3 messages): Asha")))
    }

    @Test fun `handles from the listener are added once`() {
        val f = facts(title = "Family", handles = listOf("Asha", "+919876543210", "Asha", " ", "Family"))
        assertEquals(listOf("Family", "Asha", "+919876543210"), contacts(f))
    }

    @Test fun `a tel uri gives the number, anything else gives nothing`() {
        assertEquals("+91 98765 43210", NotificationReader.phoneFromUri("tel:+91%2098765%2043210"))
        assertEquals("9876543210", NotificationReader.phoneFromUri("TEL:9876543210"))
        assertNull(NotificationReader.phoneFromUri("mailto:asha@example.com"))
        assertNull(NotificationReader.phoneFromUri("content://com.android.contacts/contacts/lookup/1"))
        assertNull(NotificationReader.phoneFromUri("tel:"))
        assertNull(NotificationReader.phoneFromUri(null))
    }

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
