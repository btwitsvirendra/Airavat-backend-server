// =============================================================================
// AIRAVAT B2B MARKETPLACE - DATA ENCRYPTION SERVICE
// Encrypt sensitive data at rest (PII, payment info, etc.)
// =============================================================================

const crypto = require('crypto');
const logger = require('../config/logger');

/**
 * Encryption configuration
 */
const CONFIG = {
  algorithm: 'aes-256-gcm',
  keyLength: 32,
  ivLength: 16,
  tagLength: 16,
  saltLength: 64,
  iterations: 100000,
  digest: 'sha512',
};

/**
 * Fields that should be encrypted in different models
 */
const ENCRYPTED_FIELDS = {
  User: ['aadhaarNumber'],
  Business: ['panNumber', 'gstin', 'bankAccountNumber', 'ifscCode'],
  BankAccount: ['accountNumber', 'ifscCode', 'iban', 'swiftCode'],
  Payment: ['cardLast4', 'bankAccountNumber'],
  Document: ['content'],
};

class DataEncryptionService {
  constructor() {
    this.masterKey = this.loadMasterKey();
    this.dataKeys = new Map();
  }

  /**
   * Load master encryption key from environment
   */
  loadMasterKey() {
    const key = process.env.DATA_ENCRYPTION_KEY;

    if (!key) {
      logger.warn('DATA_ENCRYPTION_KEY not set, generating temporary key');
      return crypto.randomBytes(CONFIG.keyLength);
    }

    // If key is base64 encoded
    if (key.length === 44) {
      return Buffer.from(key, 'base64');
    }

    // If key is hex encoded
    if (key.length === 64) {
      return Buffer.from(key, 'hex');
    }

    // Derive key from passphrase
    return crypto.scryptSync(key, 'airavat-salt', CONFIG.keyLength);
  }

  /**
   * Generate a data encryption key (DEK)
   */
  generateDataKey() {
    return crypto.randomBytes(CONFIG.keyLength);
  }

  /**
   * Encrypt data encryption key with master key
   */
  encryptDataKey(dataKey) {
    const iv = crypto.randomBytes(CONFIG.ivLength);
    const cipher = crypto.createCipheriv(CONFIG.algorithm, this.masterKey, iv);

    let encrypted = cipher.update(dataKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
      encryptedKey: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  /**
   * Decrypt data encryption key
   */
  decryptDataKey(encryptedKeyData) {
    const { encryptedKey, iv, authTag } = encryptedKeyData;

    const decipher = crypto.createDecipheriv(
      CONFIG.algorithm,
      this.masterKey,
      Buffer.from(iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    let decrypted = decipher.update(Buffer.from(encryptedKey, 'base64'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted;
  }

  // ===========================================================================
  // FIELD-LEVEL ENCRYPTION
  // ===========================================================================

  /**
   * Encrypt a single value
   */
  encrypt(plaintext, context = {}) {
    if (!plaintext) return null;

    try {
      const iv = crypto.randomBytes(CONFIG.ivLength);

      // Use master key or derive context-specific key
      const key = context.key || this.masterKey;

      const cipher = crypto.createCipheriv(CONFIG.algorithm, key, iv);

      // Add context as AAD (Additional Authenticated Data)
      if (context.aad) {
        cipher.setAAD(Buffer.from(JSON.stringify(context.aad)));
      }

      const plainBuffer = Buffer.from(plaintext.toString(), 'utf8');
      let encrypted = cipher.update(plainBuffer);
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      const authTag = cipher.getAuthTag();

      // Format: version:iv:authTag:encrypted
      return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
    } catch (error) {
      logger.error('Encryption failed', { error: error.message });
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt a single value
   */
  decrypt(encryptedData, context = {}) {
    if (!encryptedData) return null;

    try {
      const parts = encryptedData.split(':');

      if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('Invalid encrypted data format');
      }

      const [, ivBase64, authTagBase64, encryptedBase64] = parts;

      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');
      const encrypted = Buffer.from(encryptedBase64, 'base64');

      const key = context.key || this.masterKey;

      const decipher = crypto.createDecipheriv(CONFIG.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      if (context.aad) {
        decipher.setAAD(Buffer.from(JSON.stringify(context.aad)));
      }

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      logger.error('Decryption failed', { error: error.message });
      throw new Error('Decryption failed');
    }
  }

  /**
   * Check if value is encrypted
   */
  isEncrypted(value) {
    if (typeof value !== 'string') return false;
    return value.startsWith('v1:') && value.split(':').length === 4;
  }

  // ===========================================================================
  // OBJECT ENCRYPTION
  // ===========================================================================

  /**
   * Encrypt specified fields in an object
   */
  encryptObject(obj, fields, context = {}) {
    if (!obj || !fields?.length) return obj;

    const encrypted = { ...obj };

    for (const field of fields) {
      if (encrypted[field] && !this.isEncrypted(encrypted[field])) {
        encrypted[field] = this.encrypt(encrypted[field], {
          ...context,
          aad: { field, ...context.aad },
        });
      }
    }

    return encrypted;
  }

  /**
   * Decrypt specified fields in an object
   */
  decryptObject(obj, fields, context = {}) {
    if (!obj || !fields?.length) return obj;

    const decrypted = { ...obj };

    for (const field of fields) {
      if (decrypted[field] && this.isEncrypted(decrypted[field])) {
        try {
          decrypted[field] = this.decrypt(decrypted[field], {
            ...context,
            aad: { field, ...context.aad },
          });
        } catch (error) {
          logger.error('Field decryption failed', { field, error: error.message });
          decrypted[field] = null;
        }
      }
    }

    return decrypted;
  }

  /**
   * Get encrypted fields for a model
   */
  getEncryptedFields(model) {
    return ENCRYPTED_FIELDS[model] || [];
  }

  // ===========================================================================
  // SEARCHABLE ENCRYPTION (Blind Index)
  // ===========================================================================

  /**
   * Create blind index for searchable encryption
   * This allows searching encrypted data without decrypting
   */
  createBlindIndex(value, key = 'default') {
    if (!value) return null;

    const hmacKey = crypto.scryptSync(
      this.masterKey,
      `blind-index-${key}`,
      32
    );

    return crypto
      .createHmac('sha256', hmacKey)
      .update(value.toString().toLowerCase().trim())
      .digest('hex');
  }

  /**
   * Encrypt with blind index
   */
  encryptWithIndex(plaintext, indexKey = 'default') {
    return {
      encrypted: this.encrypt(plaintext),
      blindIndex: this.createBlindIndex(plaintext, indexKey),
    };
  }

  // ===========================================================================
  // KEY ROTATION
  // ===========================================================================

  /**
   * Rotate encryption key for a value
   */
  rotateKey(encryptedData, oldKey, newKey) {
    const decrypted = this.decrypt(encryptedData, { key: oldKey });
    return this.encrypt(decrypted, { key: newKey });
  }

  /**
   * Re-encrypt all data with new master key
   */
  async reencryptAll(prisma, newMasterKey) {
    const oldMasterKey = this.masterKey;
    const stats = { processed: 0, failed: 0 };

    for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
      const records = await prisma[model.toLowerCase()].findMany();

      for (const record of records) {
        try {
          const updates = {};
          let needsUpdate = false;

          for (const field of fields) {
            if (record[field] && this.isEncrypted(record[field])) {
              // Decrypt with old key
              const decrypted = this.decrypt(record[field], { key: oldMasterKey });
              
              // Re-encrypt with new key
              this.masterKey = newMasterKey;
              updates[field] = this.encrypt(decrypted);
              this.masterKey = oldMasterKey;
              
              needsUpdate = true;
            }
          }

          if (needsUpdate) {
            await prisma[model.toLowerCase()].update({
              where: { id: record.id },
              data: updates,
            });
            stats.processed++;
          }
        } catch (error) {
          logger.error('Key rotation failed for record', {
            model,
            id: record.id,
            error: error.message,
          });
          stats.failed++;
        }
      }
    }

    // Update master key after successful rotation
    this.masterKey = newMasterKey;
    
    return stats;
  }

  // ===========================================================================
  // PRISMA MIDDLEWARE
  // ===========================================================================

  /**
   * Create Prisma middleware for automatic encryption/decryption
   */
  createPrismaMiddleware() {
    return async (params, next) => {
      const model = params.model;
      const fields = this.getEncryptedFields(model);

      if (fields.length === 0) {
        return next(params);
      }

      // Encrypt on create/update
      if (['create', 'update', 'upsert', 'createMany', 'updateMany'].includes(params.action)) {
        if (params.args.data) {
          params.args.data = this.encryptObject(params.args.data, fields, {
            aad: { model },
          });
        }
      }

      const result = await next(params);

      // Decrypt on read
      if (['findUnique', 'findFirst', 'findMany'].includes(params.action)) {
        if (Array.isArray(result)) {
          return result.map((item) =>
            this.decryptObject(item, fields, { aad: { model } })
          );
        } else if (result) {
          return this.decryptObject(result, fields, { aad: { model } });
        }
      }

      return result;
    };
  }

  // ===========================================================================
  // SECURE STORAGE
  // ===========================================================================

  /**
   * Store sensitive data securely
   */
  async secureStore(prisma, key, value, metadata = {}) {
    const encrypted = this.encrypt(JSON.stringify(value));

    await prisma.secureStorage.upsert({
      where: { key },
      create: {
        key,
        value: encrypted,
        metadata,
        createdAt: new Date(),
      },
      update: {
        value: encrypted,
        metadata,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Retrieve securely stored data
   */
  async secureRetrieve(prisma, key) {
    const record = await prisma.secureStorage.findUnique({
      where: { key },
    });

    if (!record) return null;

    try {
      const decrypted = this.decrypt(record.value);
      return JSON.parse(decrypted);
    } catch (error) {
      logger.error('Failed to retrieve secure data', { key, error: error.message });
      return null;
    }
  }

  /**
   * Delete securely stored data
   */
  async secureDelete(prisma, key) {
    await prisma.secureStorage.delete({
      where: { key },
    });
  }
}

// Export singleton
const dataEncryption = new DataEncryptionService();

module.exports = dataEncryption;
