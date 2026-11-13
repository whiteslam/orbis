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
 * If the passphrase can't be recovered (the Keystore key is gone or changed, or the saved value
 * is missing or damaged), the old database can never be opened again, so it is deleted and a
 * fresh one is started. A fresh, empty store is the safe outcome; it never crash-loops.
 */
internal class KeyManager(context: Context) {
    private val context = context.applicationContext
    private val prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The SQLCipher passphrase, as SQLCipher's raw-key form `x'<64 hex>'`. */
    fun passphrase(): ByteArray {
        val saved = prefs.getString(WRAPPED, null)
        val key = saved?.let { runCatching { unwrap(it) }.getOrNull() }?.takeIf { it.size == KEY_BYTES }
            ?: run {
                reset()
                storeNewKey()
            }
        return rawKey(key)
    }

    /** Deletes the database, the saved passphrase and the Keystore key. */
    fun reset() {
        context.deleteDatabase(OrbisDatabase.NAME)
        prefs.edit().remove(WRAPPED).commit()
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

    private fun unwrap(saved: String): ByteArray? {
        val bytes = Base64.decode(saved, Base64.NO_WRAP)
        if (bytes.size <= IV_BYTES) return null
        val secret = keyStore().getKey(ALIAS, null) as? SecretKey ?: return null
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        return cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES)
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
        const val ALIAS = "orbis_store_key"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEY_BYTES = 32
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128

        /** SQLCipher's raw-key syntax: the bytes are the key itself, with no slow key derivation. */
        fun rawKey(key: ByteArray): ByteArray {
            val digits = "0123456789abcdef"
            val hex = StringBuilder(key.size * 2)
            for (b in key) {
                val v = b.toInt() and 0xff
                hex.append(digits[v ushr 4]).append(digits[v and 0x0f])
            }
            return "x'$hex'".toByteArray(Charsets.US_ASCII)
        }
    }
}
