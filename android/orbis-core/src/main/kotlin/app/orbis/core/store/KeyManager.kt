package app.orbis.core.store

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Holds the database passphrase: 32 random bytes, wrapped by a non-exportable Android Keystore
 * AES-GCM key and kept (base64 of IV + ciphertext) in SharedPreferences.
 *
 * Ruling R18: the store is deleted and started fresh only when the key is definitively gone
 * (Keystore alias missing, key permanently invalidated, a bad GCM tag, or a missing, malformed
 * or wrong-length saved value; see [KeyRecovery.isKeyGone]). Any other failure is rethrown so
 * the caller retries later, unless such failures have lasted more than 24 hours.
 */
internal class KeyManager(context: Context, clock: () -> Long = System::currentTimeMillis) {
    private val context = context.applicationContext
    private val prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val recovery = KeyRecovery(PrefsFailureClock(), clock)

    /**
     * The SQLCipher passphrase, as SQLCipher's raw-key form `x'<64 hex>'`. The caller owns the
     * array and should zero it when done. Throws when the keystore fails in a way that may pass.
     */
    fun passphrase(): ByteArray {
        val saved = prefs.getString(WRAPPED, null)
        val key = if (saved == null) {
            freshKey()
        } else {
            try {
                unwrap(saved).also { recovery.onSuccess() }
            } catch (e: Exception) {
                if (!recovery.shouldReset(e)) throw e
                freshKey()
            }
        }
        try {
            return rawKey(key)
        } finally {
            key.fill(0)
        }
    }

    private fun freshKey(): ByteArray {
        reset()
        return storeNewKey()
    }

    /** Deletes the database, the saved passphrase and the Keystore key. */
    fun reset() {
        context.deleteDatabase(OrbisDatabase.NAME)
        prefs.edit().remove(WRAPPED).remove(FIRST_FAILURE).commit()
        runCatching { keyStore().deleteEntry(ALIAS) }
    }

    /** Makes, wraps and saves a new passphrase. Does not touch the database. */
    fun storeNewKey(): ByteArray {
        val key = ByteArray(KEY_BYTES).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
        val wrapped = cipher.iv + cipher.doFinal(key)
        check(prefs.edit().putString(WRAPPED, Base64.encodeToString(wrapped, Base64.NO_WRAP)).commit()) {
            "Could not save the database key"
        }
        return key
    }

    private fun unwrap(saved: String): ByteArray {
        val bytes = try {
            Base64.decode(saved, Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
            throw KeyGoneException("The saved database key is not base64", e)
        }
        if (bytes.size <= IV_BYTES) throw KeyGoneException("The saved database key is too short")
        val secret = keyStore().getKey(ALIAS, null) as? SecretKey
            ?: throw KeyGoneException("The Keystore key is missing")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        val key = cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES)
        if (key.size != KEY_BYTES) {
            key.fill(0)
            throw KeyGoneException("The saved database key has the wrong length")
        }
        return key
    }

    private inner class PrefsFailureClock : FailureClock {
        override fun firstFailureAt(): Long? =
            if (prefs.contains(FIRST_FAILURE)) prefs.getLong(FIRST_FAILURE, 0L) else null

        override fun setFirstFailureAt(at: Long) {
            prefs.edit().putLong(FIRST_FAILURE, at).commit()
        }

        override fun clearFirstFailure() {
            prefs.edit().remove(FIRST_FAILURE).commit()
        }
    }

    private fun wrappingKey(): SecretKey {
        (keyStore().getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    internal companion object {
        const val PREFS = "orbis_store_key"
        const val WRAPPED = "wrapped_passphrase"
        const val FIRST_FAILURE = "first_unwrap_failure_at"
        const val ALIAS = "orbis_store_key"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEY_BYTES = 32
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128

        /** SQLCipher's raw-key syntax: the bytes are the key itself, with no slow key derivation. */
        fun rawKey(key: ByteArray): ByteArray {
            // Built straight into bytes, with no String copy of the key left on the heap.
            val out = ByteArray(key.size * 2 + 3)
            out[0] = X
            out[1] = QUOTE
            for ((i, b) in key.withIndex()) {
                val v = b.toInt() and 0xff
                out[2 + i * 2] = HEX[v ushr 4]
                out[3 + i * 2] = HEX[v and 0x0f]
            }
            out[out.size - 1] = QUOTE
            return out
        }

        private val HEX = "0123456789abcdef".toByteArray(Charsets.US_ASCII)
        private const val X: Byte = 0x78 // x
        private const val QUOTE: Byte = 0x27 // '
    }
}
