// =============================================================================
// AIRAVAT B2B MARKETPLACE - SECURITY SERVICE
// Advanced security utilities: encryption, hashing, data protection
// =============================================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { promisify } = require('util');
const logger = require('../config/logger');

const scrypt = promisify(crypto.scrypt);

class SecurityService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    this.ivLength = 16;
    this.saltLength = 32;
    this.tagLength = 16;
    this.keyLength = 32;
  }

  // ===========================================================================
  // SYMMETRIC ENCRYPTION (AES-256-GCM)
  // ===========================================================================

  /**
   * Encrypt sensitive data (PII, payment info, etc.)
   */
  encrypt(plaintext) {
    try {
      if (!plaintext) return null;

      const iv = crypto.randomBytes(this.ivLength);
      const key = Buffer.from(this.encryptionKey, 'hex');
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:encryptedData
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('Encryption failed', { error: error.message });
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData) {
    try {
      if (!encryptedData) return null;

      const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const key = Buffer.from(this.encryptionKey, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', { error: error.message });
      throw new Error('Decryption failed');
    }
  }

  /**
   * Encrypt object fields
   */
  encryptObject(obj, fieldsToEncrypt) {
    const encrypted = { ...obj };
    for (const field of fieldsToEncrypt) {
      if (encrypted[field]) {
        encrypted[field] = this.encrypt(encrypted[field]);
      }
    }
    return encrypted;
  }

  /**
   * Decrypt object fields
   */
  decryptObject(obj, fieldsToDecrypt) {
    const decrypted = { ...obj };
    for (const field of fieldsToDecrypt) {
      if (decrypted[field]) {
        decrypted[field] = this.decrypt(decrypted[field]);
      }
    }
    return decrypted;
  }

  // ===========================================================================
  // PASSWORD HASHING (Argon2-like with scrypt)
  // ===========================================================================

  /**
   * Hash password with scrypt (memory-hard function)
   */
  async hashPassword(password) {
    const salt = crypto.randomBytes(this.saltLength);
    const derivedKey = await scrypt(password, salt, this.keyLength);
    return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password, hash) {
    const [saltHex, keyHex] = hash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const keyBuffer = Buffer.from(keyHex, 'hex');
    const derivedKey = await scrypt(password, salt, this.keyLength);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  }

  /**
   * Hash with bcrypt (for compatibility)
   */
  async hashWithBcrypt(password, rounds = 12) {
    return bcrypt.hash(password, rounds);
  }

  /**
   * Verify bcrypt hash
   */
  async verifyBcrypt(password, hash) {
    return bcrypt.compare(password, hash);
  }

  // ===========================================================================
  // HASHING & HMAC
  // ===========================================================================

  /**
   * Create SHA-256 hash
   */
  hash(data, algorithm = 'sha256') {
    return crypto.createHash(algorithm).update(data).digest('hex');
  }

  /**
   * Create HMAC signature
   */
  hmac(data, secret, algorithm = 'sha256') {
    return crypto.createHmac(algorithm, secret).update(data).digest('hex');
  }

  /**
   * Verify HMAC signature (timing-safe)
   */
  verifyHmac(data, signature, secret, algorithm = 'sha256') {
    const expectedSignature = this.hmac(data, secret, algorithm);
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  }

  // ===========================================================================
  // TOKEN GENERATION
  // ===========================================================================

  /**
   * Generate secure random token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate URL-safe token
   */
  generateUrlSafeToken(length = 32) {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Generate numeric OTP
   */
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      otp += digits[randomBytes[i] % 10];
    }
    return otp;
  }

  /**
   * Generate API key
   */
  generateApiKey(prefix = 'ak') {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(24).toString('base64url');
    return `${prefix}_${timestamp}_${random}`;
  }

  // ===========================================================================
  // DATA MASKING & SANITIZATION
  // ===========================================================================

  /**
   * Mask sensitive data for logging
   */
  maskSensitiveData(data, fieldsToMask = []) {
    const defaultFields = [
      'password', 'token', 'secret', 'apiKey', 'creditCard',
      'cvv', 'ssn', 'aadhaar', 'pan', 'bankAccount',
    ];
    const allFields = [...new Set([...defaultFields, ...fieldsToMask])];

    const mask = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      const masked = Array.isArray(obj) ? [...obj] : { ...obj };

      for (const key of Object.keys(masked)) {
        if (allFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
          masked[key] = '***MASKED***';
        } else if (typeof masked[key] === 'object') {
          masked[key] = mask(masked[key]);
        }
      }

      return masked;
    };

    return mask(data);
  }

  /**
   * Mask email address
   */
  maskEmail(email) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    const maskedLocal = local.charAt(0) + '***' + local.charAt(local.length - 1);
    return `${maskedLocal}@${domain}`;
  }

  /**
   * Mask phone number
   */
  maskPhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.slice(0, 2) + '****' + cleaned.slice(-4);
  }

  /**
   * Mask credit card
   */
  maskCreditCard(cardNumber) {
    if (!cardNumber) return '';
    const cleaned = cardNumber.replace(/\D/g, '');
    return '**** **** **** ' + cleaned.slice(-4);
  }

  /**
   * Mask Aadhaar number
   */
  maskAadhaar(aadhaar) {
    if (!aadhaar) return '';
    const cleaned = aadhaar.replace(/\D/g, '');
    return 'XXXX XXXX ' + cleaned.slice(-4);
  }

  /**
   * Mask PAN
   */
  maskPAN(pan) {
    if (!pan) return '';
    return pan.slice(0, 2) + 'XXXXX' + pan.slice(-3);
  }

  // ===========================================================================
  // INPUT SANITIZATION
  // ===========================================================================

  /**
   * Sanitize string input
   */
  sanitizeString(input) {
    if (typeof input !== 'string') return input;

    return input
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  /**
   * Sanitize object recursively
   */
  sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') {
      return this.sanitizeString(obj);
    }

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Remove null bytes (security issue)
   */
  removeNullBytes(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/\0/g, '');
  }

  // ===========================================================================
  // SIGNATURE VERIFICATION
  // ===========================================================================

  /**
   * Verify Razorpay webhook signature
   */
  verifyRazorpaySignature(body, signature, secret) {
    const expectedSignature = this.hmac(body, secret, 'sha256');
    return this.timingSafeEqual(signature, expectedSignature);
  }

  /**
   * Verify Stripe webhook signature
   */
  verifyStripeSignature(payload, header, secret) {
    const elements = header.split(',');
    const signatureMap = {};

    for (const element of elements) {
      const [key, value] = element.split('=');
      signatureMap[key] = value;
    }

    const timestamp = signatureMap['t'];
    const signature = signatureMap['v1'];

    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = this.hmac(signedPayload, secret, 'sha256');

    return this.timingSafeEqual(signature, expectedSignature);
  }

  /**
   * Timing-safe string comparison
   */
  timingSafeEqual(a, b) {
    if (!a || !b) return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  // ===========================================================================
  // SECURE RANDOM
  // ===========================================================================

  /**
   * Generate secure random integer
   */
  randomInt(min, max) {
    const range = max - min + 1;
    const bytesNeeded = Math.ceil(Math.log2(range) / 8);
    const maxValid = Math.floor((256 ** bytesNeeded) / range) * range - 1;

    let randomValue;
    do {
      randomValue = crypto.randomBytes(bytesNeeded).readUIntBE(0, bytesNeeded);
    } while (randomValue > maxValid);

    return min + (randomValue % range);
  }

  /**
   * Shuffle array securely
   */
  secureShuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ===========================================================================
  // KEY DERIVATION
  // ===========================================================================

  /**
   * Derive key from password (for encryption keys)
   */
  async deriveKey(password, salt, keyLength = 32) {
    const derivedKey = await scrypt(password, salt, keyLength);
    return derivedKey.toString('hex');
  }

  /**
   * Generate key pair for asymmetric encryption
   */
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
  }

  /**
   * Encrypt with public key
   */
  encryptWithPublicKey(data, publicKey) {
    const encrypted = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(data)
    );
    return encrypted.toString('base64');
  }

  /**
   * Decrypt with private key
   */
  decryptWithPrivateKey(encryptedData, privateKey) {
    const decrypted = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(encryptedData, 'base64')
    );
    return decrypted.toString('utf8');
  }
}

module.exports = new SecurityService();
