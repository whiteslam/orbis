package app.orbis.core.notify

import app.orbis.core.rules.Masking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationSorterTest {
    private fun sort(pkg: String?, text: String) = NotificationSorter.sort(pkg, text, Masking.mask(text))

    @Test
    fun `a bank alert is a transaction`() {
        val s = sort(null, "Rs.1,250.00 debited from A/c XX1234 on 14-11-26 to SWIGGY. Not you? Call 1800")!!
        assertEquals("transaction", s.kind)
        val c = JSONObject(s.content)
        assertEquals(1, c.getInt("v"))
        assertTrue(c.isNull("app"))
        assertEquals("1250.00", c.getString("amount"))
        assertEquals("INR", c.getString("currency"))
        assertEquals("expense", c.getString("direction"))
        assertEquals("SWIGGY", c.getString("merchant"))
        assertTrue(c.getString("text").contains("debited"))
    }

    @Test
    fun `the app is kept and a missing merchant is null`() {
        val s = sort("com.bank", "Rs 500 paid to 9876543210")!!
        assertEquals("transaction", s.kind)
        val c = JSONObject(s.content)
        assertEquals("com.bank", c.getString("app"))
        assertTrue(c.isNull("merchant"))
        assertEquals("Rs 500 paid to ••••3210", c.getString("text"))
    }

    @Test
    fun `a missed call from a dialer is a missed contact`() {
        val s = sort("com.whatsapp", "Asha\nMissed voice call")!!
        assertEquals("missed_contact", s.kind)
        val c = JSONObject(s.content)
        assertEquals("Asha", c.getString("who"))
        assertEquals("com.whatsapp", c.getString("app"))
    }

    @Test
    fun `a missed call from another app is not sorted`() {
        assertNull(sort("com.example.chat", "Missed call"))
    }

    @Test
    fun `a delivery is a package`() {
        assertEquals("package", sort("com.amazon.mShop.android.shopping", "Your package was delivered")!!.kind)
        assertEquals("package", sort(null, "Order has been placed")!!.kind)
    }

    @Test
    fun `interview mail from a job app is career`() {
        val s = sort("com.google.android.gm", "Acme HR\nInterview invitation for Friday")!!
        assertEquals("career", s.kind)
    }

    @Test
    fun `interview wording from a non-job app is not career`() {
        assertNull(sort("com.example.chat", "Interview invitation for Friday"))
    }

    @Test
    fun `a chat message is not sorted`() {
        assertNull(sort("com.whatsapp", "Asha\nsee you at 5"))
    }

    @Test
    fun `a missed call wins over a delivery`() {
        assertEquals("missed_contact", sort("com.whatsapp", "Rider\nMissed call, order delivered")!!.kind)
    }

    @Test
    fun `one time codes are recognised`() {
        assertTrue(NotificationSorter.isOneTimeCode("123456 is your OTP for login"))
        assertTrue(NotificationSorter.isOneTimeCode("Use code 4821 to sign in"))
        assertTrue(NotificationSorter.isOneTimeCode("Your verification code is here"))
        assertFalse(NotificationSorter.isOneTimeCode("Rs 1,250 debited"))
        assertFalse(NotificationSorter.isOneTimeCode("Zip code: please call us"))
    }

    @Test
    fun `content stays under 4000 characters for a huge text`() {
        val text = "Order delivered " + "x".repeat(10_000)
        val s = sort("com.shop", text)
        assertNotNull(s)
        assertTrue(s!!.content.length <= 4000)
        assertEquals(1000, JSONObject(s.content).getString("text").length)
    }
}
