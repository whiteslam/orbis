package app.orbis.core.rules

import org.junit.Assert.assertEquals
import org.junit.Test

class MaskingTest {
    private fun check(input: String, expected: String) =
        assertEquals(expected, Masking.mask(input))

    @Test fun otpCodeIsHidden() =
        check("Your OTP for login is 482913. Do not share.", "Your OTP for login is [code]. Do not share.")

    @Test fun verificationCodeIsHidden() =
        check("Your verification code is 1234", "Your verification code is [code]")

    @Test fun bankDebitKeepsAmountsAndDatesButMasksReference() =
        check(
            "Rs.1,250.00 debited from A/c XX1234 on 12-11-26. UPI Ref 431298765012.",
            "Rs.1,250.00 debited from A/c XX1234 on 12-11-26. UPI Ref ••••5012.",
        )

    @Test fun cardNumberWithSpacesIsMasked() =
        check("Card 4111 1111 1111 1111 used", "Card ••••1111 used")

    @Test fun phoneNumberWithSpaceIsMasked() =
        check("Call me on 98765 43210", "Call me on ••••3210")

    @Test fun phoneNumberWithHyphenIsMasked() =
        check("Call 98765-43210 now", "Call ••••3210 now")

    @Test fun passwordIsHidden() = check("password: hunter2", "password [hidden]")

    @Test fun passwordWithIsIsHidden() = check("My PIN is 4321 ok", "My PIN [hidden] ok")

    @Test fun shortNumbersWithoutKeywordStay() = check("Order 1234 shipped", "Order 1234 shipped")

    @Test fun timesAndDatesStay() =
        check("Meeting at 10:30 on 12/11/2026", "Meeting at 10:30 on 12/11/2026")

    @Test fun indianGroupedAmountStays() = check("₹1,00,000 credited", "₹1,00,000 credited")

    @Test fun ordinaryWordsAreNotMangled() = check("Shipping 2 items today", "Shipping 2 items today")

    @Test fun keywordInsideAWordIsIgnored() = check("barcode 123456", "barcode 123456")

    @Test fun plainTextIsUnchanged() = check("See you at lunch", "See you at lunch")

    @Test fun emptyTextIsUnchanged() = check("", "")
}
