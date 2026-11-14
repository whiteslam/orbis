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

    // The old TypeScript parser (lib/finance/parse-alert.ts at 563a9f9^) returns "unrecognized"
    // (every field null) for this text: the amount and the debit sit in segment one, but
    // "Avl bal Rs 12,000" is a second segment that carries an amount, so two candidates
    // are ambiguous. The Kotlin port keeps that rule.
    @Test
    fun `a balance line makes two candidate segments, so it is not a transaction`() {
        assertNull(TransactionParser.parse("Rs 500 debited. Avl bal Rs 12,000"))
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
