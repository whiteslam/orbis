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

    private fun assertNoLoneSurrogates(s: String) {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate()) {
                i += 2
                continue
            }
            assertFalse("lone surrogate at $i", c.isSurrogate())
            i++
        }
    }

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
    fun `who is the first line that is not the missed call line`() {
        val g = sort("com.google.android.dialer", "Missed call\nAsha")!!
        assertEquals("Asha", JSONObject(g.content).getString("who"))
        val w = sort("com.whatsapp", "Asha\nMissed voice call")!!
        assertEquals("Asha", JSONObject(w.content).getString("who"))
    }

    @Test
    fun `a missed call with no name has no who`() {
        val s = sort("com.android.dialer", "Missed call")!!
        assertEquals("missed_contact", s.kind)
        assertFalse(JSONObject(s.content).has("who"))
    }

    @Test
    fun `a missed call from another app is not sorted`() {
        assertNull(sort("com.example.chat", "Missed call"))
    }

    @Test
    fun `a delivery is a package`() {
        assertEquals("package", sort("com.amazon.mShop.android.shopping", "Your package was delivered")!!.kind)
        assertEquals("package", sort(null, "Order has been placed")!!.kind)
        assertEquals("package", sort("in.amazon.mShop.android.shopping", "Your Amazon order has been shipped")!!.kind)
        // Bank and courier texts arrive through Messages, so it stays allowed.
        assertEquals("package", sort("com.google.android.apps.messaging", "Your parcel is out for delivery")!!.kind)
    }

    @Test
    fun `delivery words with no shipment are not a package`() {
        assertNull(sort("com.whatsapp", "Amma\nThe baby was delivered this morning"))
        assertNull(sort("com.google.android.apps.messaging", "The baby was delivered this morning"))
        assertNull(sort("com.example.news", "Speech delivered at the summit"))
    }

    @Test
    fun `a chat app is never a package, even about an order`() {
        for (chat in listOf(
            "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger",
            "org.thoughtcrime.securesms", "com.instagram.android", "com.facebook.orca",
        )) {
            assertNull(chat, sort(chat, "Asha\nYour order was delivered, it's at the door"))
        }
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
        assertTrue(NotificationSorter.isOneTimeCode("Your passcode is 482193"))
        assertTrue(NotificationSorter.isOneTimeCode("Your verification code: 55821"))
        assertFalse(NotificationSorter.isOneTimeCode("Rs 1,250 debited"))
        assertFalse(NotificationSorter.isOneTimeCode("Zip code: please call us"))
    }

    @Test
    fun `a safety footer is not a code, and the payment is still sorted`() {
        val text = "Rs 500 debited from A/c XX12 to SWIGGY. Never share your OTP."
        assertFalse(NotificationSorter.isOneTimeCode(text))
        assertEquals("transaction", sort("com.bank", text)!!.kind)
    }

    @Test
    fun `a card or account ending near an OTP footer is not a code, and the payment is sorted`() {
        val card = "Rs 500 spent on card ending 1234 at AMAZON. Never share OTP"
        val account = "Rs 500 debited from a/c **1234. Do not share OTP with anyone"
        for (text in listOf(card, account)) {
            assertFalse(text, NotificationSorter.isOneTimeCode(text))
            assertEquals(text, "transaction", sort("com.bank", text)!!.kind)
        }
        assertFalse(NotificationSorter.isOneTimeCode("Acct XX4821 debited Rs 90. OTP never asked"))
        assertFalse(NotificationSorter.isOneTimeCode("Account no. 482193 credited. Never share your OTP"))
        // A real code still counts, even with an account mentioned elsewhere.
        assertTrue(NotificationSorter.isOneTimeCode("482193 is the OTP for your card ending 1234"))
        assertTrue(NotificationSorter.isOneTimeCode("OTP for a/c ending 1234 is 482193"))
    }

    @Test
    fun `amounts and ids near the word code are not codes`() {
        assertFalse(NotificationSorter.isOneTimeCode("Rs.12000.00 debited, ref code HDFC0001234"))
        assertFalse(NotificationSorter.isOneTimeCode("INR 2500 sent, use code to claim cashback"))
        assertFalse(NotificationSorter.isOneTimeCode("Use code on Rs 2500 order"))
        assertFalse(NotificationSorter.isOneTimeCode("Code applied: \$4500 off"))
        assertFalse(NotificationSorter.isOneTimeCode("Use code for 12,5000.75 today"))
    }

    @Test
    fun `an emoji pair at the cut is kept whole`() {
        val text = "Order delivered " + "x".repeat(983) + "😀tail"
        assertEquals('\uD83D', text[999])
        val s = sort("com.shop", text)!!
        val t = JSONObject(s.content).getString("text")
        assertNoLoneSurrogates(t)
        assertNoLoneSurrogates(s.content)
        assertEquals(999, t.length)
    }

    @Test
    fun `a lone surrogate in the text becomes a replacement character`() {
        val text = "Order delivered \uD83D alone \uDE00 too"
        val s = sort("com.shop", text)!!
        val t = JSONObject(s.content).getString("text")
        assertNoLoneSurrogates(t)
        assertTrue(t.contains('�'))
    }

    @Test
    fun `control characters are shortened so the content fits`() {
        val text = "Order delivered " + "\u0001".repeat(1000)
        val s = sort("com.shop", text)!!
        assertEquals("package", s.kind)
        assertTrue(s.content.length <= 4000)
        assertTrue(JSONObject(s.content).getString("text").startsWith("Order delivered "))
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
