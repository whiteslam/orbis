package app.orbis.core.sync

import android.content.Context

/**
 * Seams the app wires up at start-up. [onRevoked] runs after a revoke has wiped the store and saved
 * `signedOutReason`; it is a no-op until the capture service's controller points it at its reconcile.
 */
object CoreHooks {
    @Volatile
    var onRevoked: (Context) -> Unit = {}
}
