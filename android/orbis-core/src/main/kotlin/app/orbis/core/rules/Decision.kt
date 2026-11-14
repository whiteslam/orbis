package app.orbis.core.rules

/** Why an item was dropped. The first six are the privacy rules, in the order they check; ONE_TIME_CODE is the sorter's. */
enum class DropReason { OTHER_PROFILE, PAUSED, SOURCE_OFF, BLOCKED_APP, BLOCKED_CONTACT, BLOCKED_KEYWORD, ONE_TIME_CODE }

sealed interface Decision {
    /** Keep the item, with [maskedText] as the only text that may be stored. */
    data class Keep(val maskedText: String) : Decision

    /** Drop the item. Nothing but the source, time and [reason] may be recorded. */
    data class Drop(val reason: DropReason) : Decision
}
