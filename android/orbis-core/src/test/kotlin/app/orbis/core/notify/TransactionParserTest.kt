package app.orbis.core.notify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TransactionParserTest {
    @Test
    fun `a bank debit gives amount, currency, direction and merchant`() {
        val text = "Rs.1,250.00 debited from A/c XX1234 on 14-11-26 to SWIGGY. Not you? Call 1800"
        assertEquals(ParsedTransaction("1250.00", "INR", "expense", "SWIGGY"), TransactionParser.parse(text))
    }

    @Test
    fun `a credit is income`() {
        val p = TransactionParser.parse("INR 5,000 credited to your account by NEFT")!!
        assertEquals("5000.00", p.amount)
        assertEquals("INR", p.currency)
        assertEquals("income", p.direction)
    }

    @Test
    fun `rupee sign and UPI wording`() {
        val p = TransactionParser.parse("₹499 paid to Zomato via UPI")!!
        assertEquals("499.00", p.amount)
        assertEquals("expense", p.direction)
        assertEquals("Zomato", p.merchant)
    }

    @Test
    fun `other currencies are mapped`() {
        assertEquals("USD", TransactionParser.parse("$12.50 spent at Store")!!.currency)
        assertEquals("EUR", TransactionParser.parse("€7 charged")!!.currency)
        assertEquals("GBP", TransactionParser.parse("£3.2 purchase")!!.let { assertEquals("3.20", it.amount); it.currency })
    }

    // The old TypeScript parser returned "unrecognized" for this text, because the balance line
    // counted as a second candidate segment. Ruling R-T3b replaces that: balance clauses are
    // dropped before the single candidate is chosen, so the payment parses.
    @Test
    fun `a balance line is dropped, so the payment still parses`() {
        val p = TransactionParser.parse("Rs 500 debited. Avl bal Rs 12,000")!!
        assertEquals("500.00", p.amount)
        assertEquals("expense", p.direction)
    }

    @Test
    fun `a bank text with a balance after the merchant parses`() {
        val p = TransactionParser.parse(
            "Rs.500.00 debited from a/c **1234 on 14-11-26 to VPA swiggy@icici. Avl Bal: Rs.12,000.50",
        )!!
        assertEquals("500.00", p.amount)
        assertEquals("expense", p.direction)
        assertEquals("INR", p.currency)
    }

    @Test
    fun `a trailing balance clause inside one segment is cut`() {
        val p = TransactionParser.parse("Rs 500 debited Avl balance Rs 12,000 as on 14-11")!!
        assertEquals("500.00", p.amount)
        val q = TransactionParser.parse("INR 90 spent at Cafe Bal is Rs 1,000")!!
        assertEquals("90.00", q.amount)
    }

    @Test
    fun `sent is an expense`() {
        val p = TransactionParser.parse(
            "Sent Rs.250.00 From HDFC Bank A/C x1234 To Asha On 14/11/26 Ref 123456789012",
        )!!
        assertEquals("250.00", p.amount)
        assertEquals("expense", p.direction)
        assertEquals("Asha", p.merchant)
    }

    @Test
    fun `a balance-only text is not a transaction`() {
        assertNull(TransactionParser.parse("Avl bal Rs 12,000 as on 14-11"))
    }

    @Test
    fun `two amounts in one sentence is not a transaction`() {
        assertNull(TransactionParser.parse("Rs 500 debited and Rs 200 credited"))
    }

    @Test
    fun `text with no money is not a transaction`() {
        assertNull(TransactionParser.parse("Your order is on the way"))
    }

    @Test
    fun `an amount with both directions is not a transaction`() {
        assertNull(TransactionParser.parse("Rs 500 debited and credited"))
    }

    @Test
    fun `trailing punctuation is trimmed from the merchant`() {
        assertEquals("Amazon", TransactionParser.parse("Rs 99 paid to Amazon,")!!.merchant)
        assertEquals("SWIGGY", TransactionParser.parse("Rs 99 debited to SWIGGY.")!!.merchant)
    }

    @Test
    fun `no merchant is null`() {
        assertNull(TransactionParser.parse("Rs 99 debited")!!.merchant)
    }

    @Test
    fun `zero and huge amounts are ignored`() {
        assertNull(TransactionParser.parse("Rs 0 debited"))
        assertNull(TransactionParser.parse("Rs 999,999,999 debited"))
    }
}
