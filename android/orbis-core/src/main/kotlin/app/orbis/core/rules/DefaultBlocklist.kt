package app.orbis.core.rules

/**
 * Apps whose notifications are never read by default: authenticators, password managers
 * and banking apps. Every ID was checked against its Google Play page (HTTP 200).
 */
object DefaultBlocklist {
    val PACKAGES: Set<String> = setOf(
        // Authenticators and password managers
        "com.google.android.apps.authenticator2",
        "com.azure.authenticator",
        "com.authy.authy",
        "com.x8bit.bitwarden",
        "com.onepassword.android",
        "com.lastpass.lpandroid",
        "com.dashlane",
        "com.callpod.android_apps.keeper",
        // Indian banking apps
        "com.sbi.lotusintouch",
        "com.csam.icici.bank.imobile",
        "com.axis.mobile",
        "com.msf.kbank.mobile",
        "com.kotak.bank.mobile",
        "com.hdfcbank.android.now",
    )
}
