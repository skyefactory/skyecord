import {debugLog} from './debugLogger.js';
var saltBytes = null;
var secretString = null;
var secretBytes = null;
// get the secret string




const urlParams = new URLSearchParams(window.location.search);
if(urlParams.has('secret')) {
    secretString = urlParams.get('secret');
    debugLog('info', `secretString: ${secretString}`);
} else {
    debugLog('error', 'No secret string found in URL parameters');
}

if(secretString){
    secretString = secretString
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    while (secretString.length % 4)
        secretString += "=";

    secretBytes = Uint8Array.from(
        atob(secretString),
        c => c.charCodeAt(0)
    );
}

export var ROOM_KEY = null;

/*
 * initializes the room key by deriving it from the secretBytes and saltBytes.
 *      params:
 *          salt - The salt bytes to use in the key derivation.
 */
export async function initializeRoomKey(salt){
    saltBytes = salt;
    if(secretBytes && saltBytes) {
        ROOM_KEY = await deriveKey(secretBytes, saltBytes);
    } else {
        debugLog('error', 'Secret or salt bytes are missing. Room key cannot be derived.');
    }
}
/*
 * derives the room key from the secretBytes and saltBytes using HKDF with SHA-256.
 *      params:
 *          secretBytes - The secret bytes to derive the key from.
 *          saltBytes - The salt bytes to use in the key derivation.
 *      returns:
 *          A Promise that resolves to the derived key.
 */

export async function deriveKey(secretBytes, saltBytes) {
    console.log(saltBytes);
    if (saltBytes?.type === "Buffer" && Array.isArray(saltBytes.data)) {
        saltBytes = new Uint8Array(saltBytes.data);
    } else if (!(saltBytes instanceof Uint8Array)) {
        saltBytes = new Uint8Array(saltBytes);
    }

    const key = await crypto.subtle.importKey(
        "raw",
        secretBytes,
        "HKDF",
        false,
        ["deriveKey"]
    );

    return await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: saltBytes,
            info: new TextEncoder().encode("skyecord-room-key")
        },
        key,
        {
            name: "AES-GCM",
            length: 256
        },
        false,
        ["encrypt", "decrypt"]
    );
}

/* encrypts the provided message using AES-GCM with the derived room key.
 *      params:
 *          message - The plaintext message to encrypt.
 *         key - The derived room key to use for encryption (default is ROOM_KEY).
 *      returns:
 *          A Promise that resolves to an object containing the encrypted data and the IV
 */
export async function encryptMessage(message, key = ROOM_KEY) {
    const data = new TextEncoder().encode(message);

    return encryptData(data, key);
}

/* decrypts the provided encrypted data using AES-GCM with the derived room key.
 *      params:
 *          encrypted - The encrypted data to decrypt.
 *          iv - The initialization vector used during encryption.
 *          key - The derived room key to use for decryption (default is ROOM_KEY).
 *      returns:
 *          A Promise that resolves to the decrypted plaintext message.
 */
export async function decryptMessage(encrypted, iv, key = ROOM_KEY) {
    const decrypted = await decryptData(encrypted, iv, key);

    return new TextDecoder().decode(decrypted);
}
/* encrypts the provided data using AES-GCM with the derived room key.
 *      params:
 *          data - The plaintext data to encrypt (Uint8Array).
 *          key - The derived room key to use for encryption (default is ROOM_KEY).
 *      returns:
 *          A Promise that resolves to an object containing the encrypted data and the IV.
 */
export async function encryptData(data, key = ROOM_KEY) {
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv
        },
        key,
        data
    );

    return {
        encrypted: new Uint8Array(encrypted),
        iv
    };
}

/* decrypts the provided encrypted data using AES-GCM with the derived room key.
 *      params:
 *          encrypted - The encrypted data to decrypt (Uint8Array).
 *          iv - The initialization vector used during encryption (Uint8Array).
 *          key - The derived room key to use for decryption (default is ROOM_KEY).
 *      returns:
 *          A Promise that resolves to the decrypted plaintext data (Uint8Array).
 */
export async function decryptData(encrypted, iv, key = ROOM_KEY) {
    return await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        encrypted
    );
}