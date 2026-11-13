package app.orbis.core.rules

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test fun cardNumberBeforeAColonIsMaskedWhole() =
        check("Card 4111 1111 1111 1111: declined", "Card ••••1111: declined")

    @Test fun aGroupBeforeATimeIsNotJoined() {
        check("on 12-11-2026 14:30", "on 12-11-2026 14:30")
        check("Call 98765 43210 14:30", "Call ••••3210 14:30")
    }

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

    @Test fun splitCodeWithHyphenIsOneToken() =
        check("Your WhatsApp code: 123-456", "Your WhatsApp code: [code]")

    @Test fun splitCodeWithSpaceIsOneToken() =
        check("123 456 is your Instagram code", "[code] is your Instagram code")

    @Test fun pinCodeDoesNotLeakTheNumber() {
        val out = Masking.mask("Your PIN code is 1234")
        assertFalse(out, out.contains("1234"))
    }

    @Test fun pinNumberDoesNotLeakTheNumber() {
        val out = Masking.mask("Your PIN number is 1234")
        assertFalse(out, out.contains("1234"))
    }

    @Test fun verifyWordTriggersCodeMasking() =
        check("Use 482913 to verify your account", "Use [code] to verify your account")

    @Test fun dateAndTimeStayUnchanged() {
        check("on 12-11-2026 14:30", "on 12-11-2026 14:30")
        check("2026-11-12 18:45", "2026-11-12 18:45")
    }

    @Test fun datesAreNotJoinedToNumbersAroundThem() {
        check("on 12-11-26 98765 43210", "on 12-11-26 ••••3210")
        check("Ref 431298765012 12-11-26", "Ref ••••5012 12-11-26")
    }

    @Test fun datesStayInCodeContext() =
        check("Your code 482913 expires 12-11-2026 14:30", "Your code [code] expires 12-11-2026 14:30")

    @Test fun maskingTwiceChangesNothing() {
        val samples = listOf(
            "Your OTP for login is 482913. Do not share.",
            "Your verification code is 1234",
            "Rs.1,250.00 debited from A/c XX1234 on 12-11-26. UPI Ref 431298765012.",
            "Card 4111 1111 1111 1111 used",
            "Card 4111 1111 1111 1111: declined",
            "Call 98765 43210 14:30",
            "Call me on 98765 43210",
            "Call 98765-43210 now",
            "password: hunter2",
            "My PIN is 4321 ok",
            "Your PIN code is 1234",
            "Your PIN number is 1234",
            "Your WhatsApp code: 123-456",
            "123 456 is your Instagram code",
            "Use 482913 to verify your account",
            "Your code is 98765 43210",
            "Order 1234 shipped",
            "Meeting at 10:30 on 12/11/2026",
            "on 12-11-2026 14:30",
            "2026-11-12 18:45",
            "₹1,00,000 credited",
            "Shipping 2 items today",
            "barcode 123456",
            "See you at lunch",
            "",
        )
        for (x in samples) assertEquals(x, Masking.mask(x), Masking.mask(Masking.mask(x)))
    }
}
