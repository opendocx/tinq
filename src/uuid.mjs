/**
 * Generate a UUID v4 using native crypto.randomUUID()
 * @returns {string} UUID v4 string
 */
export const uuidv4 = () => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : (typeof window !== 'undefined' ? window.crypto : typeof crypto !== 'undefined' ? crypto : null)
  
  if (cryptoObj && cryptoObj.randomUUID) {
    return cryptoObj.randomUUID()
  }
  // Fallback for older browsers using crypto.getRandomValues()
  if (!cryptoObj || !cryptoObj.getRandomValues) {
    throw new Error('Crypto API is not available')
  }
  const bytes = new Uint8Array(16)
  cryptoObj.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // Variant 10
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-')
}

/**
 * Generate a UUID (alias for uuidv4 for compatibility)
 * @returns {string} UUID v4 string
 */
export const uuid = uuidv4

/**
 * Generate a UUID v1-like using crypto (uses v4 since native crypto doesn't provide v1)
 * For compatibility with uuid/v1 imports
 * @returns {string} UUID v4 string
 */
export const uuidv1 = uuidv4

/**
 * Export v4 as named export for compatibility with import { v4 } from 'uuid'
 */
export const v4 = uuidv4

/**
 * Export v1 as named export for compatibility with import { v1 } from 'uuid'
 */
export const v1 = uuidv4

export default uuid
