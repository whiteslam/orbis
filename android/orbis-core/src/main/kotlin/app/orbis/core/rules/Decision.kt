package app.orbis.core.rules

/** Why an item was dropped. The order is the order the rules check in. */
enum class DropReason { OTHER_PROFILE, PAUSED, SOURCE_OFF, BLOCKED_APP, BLOCKED_CONTACT, BLOCKED_KEYWORD }

sealed interface Decision {
    /** Keep the item, with [maskedText] as the only text that may be stored. */
    data class Keep(val maskedText: String) : Decision

    /** Drop the item. Nothing but the source, time and [reason] may be recorded. */
    data class Drop(val reason: DropReason) : Decision
}
