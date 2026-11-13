package app.orbis.core.rules

object PrivacyRules {
    /**
     * Decides whether [item] may be kept. The checks run in [DropReason] order, so the first
     * reason that applies is the one returned. A kept item carries its masked text.
     */
    fun decide(item: CapturedItem, settings: PrivacySettings, now: Long): Decision {
        if (item.fromOtherProfile) return Decision.Drop(DropReason.OTHER_PROFILE)

        val pausedUntil = settings.pausedUntil
        if (pausedUntil != null && now < pausedUntil) return Decision.Drop(DropReason.PAUSED)

        if (item.source !in settings.enabled) return Decision.Drop(DropReason.SOURCE_OFF)

        val pkg = item.packageName
        if (pkg != null && pkg in settings.blockedPackages) return Decision.Drop(DropReason.BLOCKED_APP)

        if (settings.blockedContacts.isNotEmpty()) {
            val blocked = settings.blockedContacts.map(::contactKey).toSet()
            if (item.contacts.any { contactKey(it) in blocked }) {
                return Decision.Drop(DropReason.BLOCKED_CONTACT)
            }
        }

        for (raw in settings.blockedKeywords) {
            val keyword = raw.trim()
            if (keyword.isEmpty()) continue
            if (item.text.contains(keyword, ignoreCase = true) ||
                item.contacts.any { it.contains(keyword, ignoreCase = true) }
            ) {
                return Decision.Drop(DropReason.BLOCKED_KEYWORD)
            }
        }

        return Decision.Keep(Masking.mask(item.text))
    }

    /**
     * A stable key for a contact, so "+91 98765-43210" and "9876543210" match. Seven or more
     * digits give the last 10 digits; anything else is lowercased, trimmed, with spaces collapsed.
     */
    fun contactKey(raw: String): String {
        val digits = raw.filter { it in '0'..'9' }
        if (digits.length >= 7) return digits.takeLast(10)
        return raw.trim().lowercase().replace(Regex("""\s+"""), " ")
    }
}
