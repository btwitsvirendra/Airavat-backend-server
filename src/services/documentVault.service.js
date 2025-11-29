// =============================================================================
// AIRAVAT B2B MARKETPLACE - DOCUMENT VAULT SERVICE
// Secure Document Storage with Access Control & Audit Trail
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const crypto = require('crypto');
const path = require('path');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');
const { generateId } = require('../utils/helpers');

// =============================================================================
// CONSTANTS
// =============================================================================

const DOCUMENT_TYPE = {
  GST_CERTIFICATE: 'GST_CERTIFICATE',
  PAN_CARD: 'PAN_CARD',
  INCORPORATION_CERTIFICATE: 'INCORPORATION_CERTIFICATE',
  BANK_STATEMENT: 'BANK_STATEMENT',
  CANCELLED_CHEQUE: 'CANCELLED_CHEQUE',
  TRADE_LICENSE: 'TRADE_LICENSE',
  IMPORT_EXPORT_CODE: 'IMPORT_EXPORT_CODE',
  MSME_CERTIFICATE: 'MSME_CERTIFICATE',
  FSSAI_LICENSE: 'FSSAI_LICENSE',
  DRUG_LICENSE: 'DRUG_LICENSE',
  CONTRACT: 'CONTRACT',
  INVOICE: 'INVOICE',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  QUOTATION: 'QUOTATION',
  SHIPPING_DOCUMENT: 'SHIPPING_DOCUMENT',
  OTHER: 'OTHER',
};

const DOCUMENT_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
};

const ACCESS_LEVEL = {
  VIEW: 'VIEW',
  DOWNLOAD: 'DOWNLOAD',
  EDIT: 'EDIT',
  FULL: 'FULL',
};

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const CACHE_TTL = {
  DOCUMENT: 300,
  ACCESS_TOKEN: 3600,
};

// =============================================================================
// DOCUMENT MANAGEMENT
// =============================================================================

/**
 * Upload document
 * @param {string} businessId - Business ID
 * @param {string} userId - User ID
 * @param {Object} file - File object
 * @param {Object} metadata - Document metadata
 * @returns {Promise<Object>} Created document
 */
const uploadDocument = async (businessId, userId, file, metadata) => {
  // Validate file
  validateFile(file);

  // Generate secure file name
  const ext = path.extname(file.originalname).toLowerCase();
  const secureFileName = `${generateId()}${ext}`;

  // Calculate checksum
  const checksum = calculateChecksum(file.buffer);

  // Check for duplicate
  const existing = await prisma.document.findFirst({
    where: { businessId, checksum },
  });

  if (existing) {
    throw new BadRequestError('Document already exists');
  }

  // Encrypt sensitive documents
  let encryptedBuffer = file.buffer;
  let encryptionKey = null;
  let iv = null;

  if (isSensitiveDocument(metadata.documentType)) {
    const encryption = encryptDocument(file.buffer);
    encryptedBuffer = encryption.encrypted;
    encryptionKey = encryption.key;
    iv = encryption.iv;
  }

  // Store file (in production, upload to S3/GCS)
  const fileUrl = await storeFile(secureFileName, encryptedBuffer);

  // Create document record
  const document = await prisma.document.create({
    data: {
      businessId,
      uploadedBy: userId,
      fileName: file.originalname,
      fileUrl,
      fileSize: file.size,
      mimeType: file.mimetype,
      documentType: metadata.documentType,
      documentNumber: metadata.documentNumber,
      description: metadata.description,
      issuedDate: metadata.issuedDate ? new Date(metadata.issuedDate) : null,
      expiryDate: metadata.expiryDate ? new Date(metadata.expiryDate) : null,
      checksum,
      encryptionKey: encryptionKey ? encryptWithMaster(encryptionKey) : null,
      encryptionIv: iv,
      status: DOCUMENT_STATUS.PENDING,
      tags: metadata.tags || [],
      category: metadata.category,
    },
  });

  // Log audit
  await logDocumentAccess(document.id, userId, 'UPLOAD', {
    fileName: file.originalname,
    documentType: metadata.documentType,
  });

  logger.info('Document uploaded', {
    documentId: document.id,
    businessId,
    documentType: metadata.documentType,
  });

  return {
    id: document.id,
    fileName: document.fileName,
    documentType: document.documentType,
    status: document.status,
    createdAt: document.createdAt,
  };
};

/**
 * Validate file
 * @param {Object} file - File object
 */
const validateFile = (file) => {
  if (!file) {
    throw new BadRequestError('No file provided');
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new BadRequestError(
      `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new BadRequestError(
      `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    );
  }
};

/**
 * Check if document type is sensitive
 * @param {string} type - Document type
 * @returns {boolean} Is sensitive
 */
const isSensitiveDocument = (type) => {
  const sensitive = [
    DOCUMENT_TYPE.PAN_CARD,
    DOCUMENT_TYPE.BANK_STATEMENT,
    DOCUMENT_TYPE.CANCELLED_CHEQUE,
    DOCUMENT_TYPE.CONTRACT,
  ];
  return sensitive.includes(type);
};

/**
 * Calculate file checksum
 * @param {Buffer} buffer - File buffer
 * @returns {string} SHA-256 checksum
 */
const calculateChecksum = (buffer) => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

/**
 * Encrypt document
 * @param {Buffer} buffer - File buffer
 * @returns {Object} Encrypted data with key and IV
 */
const encryptDocument = (buffer) => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);

  return {
    encrypted,
    key: key.toString('hex'),
    iv: iv.toString('hex'),
  };
};

/**
 * Decrypt document
 * @param {Buffer} encrypted - Encrypted buffer
 * @param {string} keyHex - Encryption key (hex)
 * @param {string} ivHex - IV (hex)
 * @returns {Buffer} Decrypted buffer
 */
const decryptDocument = (encrypted, keyHex, ivHex) => {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

/**
 * Encrypt key with master key
 * @param {string} key - Key to encrypt
 * @returns {string} Encrypted key
 */
const encryptWithMaster = (key) => {
  const masterKey = Buffer.from(config.app.encryptionKey || 'default-key-32-bytes-long!!!!', 'utf8');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', masterKey.slice(0, 32), iv);

  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);

  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Decrypt key with master key
 * @param {string} encryptedKey - Encrypted key
 * @returns {string} Decrypted key
 */
const decryptWithMaster = (encryptedKey) => {
  const [ivHex, encryptedHex] = encryptedKey.split(':');
  const masterKey = Buffer.from(config.app.encryptionKey || 'default-key-32-bytes-long!!!!', 'utf8');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', masterKey.slice(0, 32), iv);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

/**
 * Store file (mock implementation)
 * @param {string} fileName - File name
 * @param {Buffer} buffer - File buffer
 * @returns {Promise<string>} File URL
 */
const storeFile = async (fileName, buffer) => {
  // In production, upload to S3/GCS
  // For now, return mock URL
  return `/documents/${fileName}`;
};

/**
 * Retrieve file (mock implementation)
 * @param {string} fileUrl - File URL
 * @returns {Promise<Buffer>} File buffer
 */
const retrieveFile = async (fileUrl) => {
  // In production, download from S3/GCS
  throw new NotFoundError('File retrieval not implemented');
};

// =============================================================================
// DOCUMENT ACCESS
// =============================================================================

/**
 * Get document
 * @param {string} documentId - Document ID
 * @param {string} userId - User ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Document
 */
const getDocument = async (documentId, userId, businessId) => {
  const cacheKey = `doc:${documentId}`;
  const cached = await cache.get(cacheKey);

  let document;
  if (cached) {
    document = cached;
  } else {
    document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        business: { select: { businessName: true } },
        uploader: { select: { firstName: true, lastName: true } },
      },
    });

    if (!document) {
      throw new NotFoundError('Document');
    }

    await cache.set(cacheKey, document, CACHE_TTL.DOCUMENT);
  }

  // Check access
  const hasAccess = await checkDocumentAccess(document, userId, businessId, ACCESS_LEVEL.VIEW);
  if (!hasAccess) {
    throw new ForbiddenError('You do not have access to this document');
  }

  // Log access
  await logDocumentAccess(documentId, userId, 'VIEW');

  return {
    ...document,
    encryptionKey: undefined, // Never expose
    encryptionIv: undefined,
  };
};

/**
 * Download document
 * @param {string} documentId - Document ID
 * @param {string} userId - User ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Download info
 */
const downloadDocument = async (documentId, userId, businessId) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new NotFoundError('Document');
  }

  // Check access
  const hasAccess = await checkDocumentAccess(document, userId, businessId, ACCESS_LEVEL.DOWNLOAD);
  if (!hasAccess) {
    throw new ForbiddenError('You do not have download access');
  }

  // Generate signed URL
  const signedUrl = generateSignedUrl(document);

  // Log access
  await logDocumentAccess(documentId, userId, 'DOWNLOAD');

  return {
    signedUrl,
    fileName: document.fileName,
    mimeType: document.mimeType,
    expiresIn: 300, // 5 minutes
  };
};

/**
 * Generate signed URL for document
 * @param {Object} document - Document object
 * @returns {string} Signed URL
 */
const generateSignedUrl = (document) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes

  // Store token
  cache.set(`doc_token:${token}`, {
    documentId: document.id,
    expiry,
  }, 300);

  return `/api/v1/documents/download/${token}`;
};

/**
 * Verify and process download token
 * @param {string} token - Download token
 * @returns {Promise<Object>} Document buffer and info
 */
const processDownloadToken = async (token) => {
  const cached = await cache.get(`doc_token:${token}`);

  if (!cached || cached.expiry < Date.now()) {
    throw new BadRequestError('Invalid or expired download link');
  }

  const document = await prisma.document.findUnique({
    where: { id: cached.documentId },
  });

  if (!document) {
    throw new NotFoundError('Document');
  }

  // Retrieve file
  let buffer = await retrieveFile(document.fileUrl);

  // Decrypt if encrypted
  if (document.encryptionKey) {
    const key = decryptWithMaster(document.encryptionKey);
    buffer = decryptDocument(buffer, key, document.encryptionIv);
  }

  // Invalidate token
  await cache.del(`doc_token:${token}`);

  return {
    buffer,
    fileName: document.fileName,
    mimeType: document.mimeType,
  };
};

/**
 * Check document access
 * @param {Object} document - Document object
 * @param {string} userId - User ID
 * @param {string} businessId - Business ID
 * @param {string} requiredLevel - Required access level
 * @returns {Promise<boolean>} Has access
 */
const checkDocumentAccess = async (document, userId, businessId, requiredLevel) => {
  // Owner always has full access
  if (document.businessId === businessId) {
    return true;
  }

  // Check explicit grants
  const grant = await prisma.documentAccessGrant.findFirst({
    where: {
      documentId: document.id,
      OR: [
        { grantedToUserId: userId },
        { grantedToBusinessId: businessId },
      ],
      expiresAt: { gt: new Date() },
    },
  });

  if (!grant) {
    return false;
  }

  // Check access level
  const levelHierarchy = [ACCESS_LEVEL.VIEW, ACCESS_LEVEL.DOWNLOAD, ACCESS_LEVEL.EDIT, ACCESS_LEVEL.FULL];
  const grantedIndex = levelHierarchy.indexOf(grant.accessLevel);
  const requiredIndex = levelHierarchy.indexOf(requiredLevel);

  return grantedIndex >= requiredIndex;
};

// =============================================================================
// ACCESS GRANTS
// =============================================================================

/**
 * Grant document access
 * @param {string} documentId - Document ID
 * @param {string} ownerId - Owner user ID
 * @param {Object} grantData - Grant data
 * @returns {Promise<Object>} Access grant
 */
const grantAccess = async (documentId, ownerId, grantData) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { business: { select: { ownerId: true } } },
  });

  if (!document) {
    throw new NotFoundError('Document');
  }

  // Verify ownership
  if (document.business.ownerId !== ownerId) {
    throw new ForbiddenError('Only document owner can grant access');
  }

  const grant = await prisma.documentAccessGrant.create({
    data: {
      documentId,
      grantedByUserId: ownerId,
      grantedToUserId: grantData.userId || null,
      grantedToBusinessId: grantData.businessId || null,
      accessLevel: grantData.accessLevel || ACCESS_LEVEL.VIEW,
      expiresAt: grantData.expiresAt
        ? new Date(grantData.expiresAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
      reason: grantData.reason,
    },
  });

  // Log audit
  await logDocumentAccess(documentId, ownerId, 'GRANT_ACCESS', {
    grantedTo: grantData.userId || grantData.businessId,
    accessLevel: grantData.accessLevel,
  });

  logger.info('Document access granted', {
    documentId,
    grantedTo: grantData.userId || grantData.businessId,
    accessLevel: grantData.accessLevel,
  });

  return grant;
};

/**
 * Revoke document access
 * @param {string} grantId - Grant ID
 * @param {string} ownerId - Owner user ID
 * @returns {Promise<Object>} Result
 */
const revokeAccess = async (grantId, ownerId) => {
  const grant = await prisma.documentAccessGrant.findUnique({
    where: { id: grantId },
    include: { document: { include: { business: { select: { ownerId: true } } } } },
  });

  if (!grant) {
    throw new NotFoundError('Access grant');
  }

  if (grant.document.business.ownerId !== ownerId) {
    throw new ForbiddenError('Only document owner can revoke access');
  }

  await prisma.documentAccessGrant.delete({ where: { id: grantId } });

  // Log audit
  await logDocumentAccess(grant.documentId, ownerId, 'REVOKE_ACCESS', {
    revokedFrom: grant.grantedToUserId || grant.grantedToBusinessId,
  });

  return { success: true };
};

/**
 * Get document access grants
 * @param {string} documentId - Document ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Array>} Access grants
 */
const getAccessGrants = async (documentId, businessId) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document || document.businessId !== businessId) {
    throw new ForbiddenError('Access denied');
  }

  return prisma.documentAccessGrant.findMany({
    where: { documentId },
    include: {
      grantedToUser: { select: { firstName: true, lastName: true, email: true } },
      grantedToBusiness: { select: { businessName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

// =============================================================================
// DOCUMENT LISTING
// =============================================================================

/**
 * Get documents for business
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated documents
 */
const getDocuments = async (businessId, options = {}) => {
  const { page = 1, limit = 20, type, status, search } = options;
  const skip = (page - 1) * limit;

  const where = { businessId };
  if (type) where.documentType = type;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { fileName: { contains: search, mode: 'insensitive' } },
      { documentNumber: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      select: {
        id: true,
        fileName: true,
        documentType: true,
        documentNumber: true,
        description: true,
        status: true,
        expiryDate: true,
        createdAt: true,
        fileSize: true,
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    documents: documents.map((d) => ({
      ...d,
      isExpired: d.expiryDate && new Date(d.expiryDate) < new Date(),
      expiringDays: d.expiryDate
        ? Math.ceil((new Date(d.expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Delete document
 * @param {string} documentId - Document ID
 * @param {string} userId - User ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Result
 */
const deleteDocument = async (documentId, userId, businessId) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new NotFoundError('Document');
  }

  if (document.businessId !== businessId) {
    throw new ForbiddenError('Access denied');
  }

  // Soft delete
  await prisma.document.update({
    where: { id: documentId },
    data: { deletedAt: new Date() },
  });

  // Log audit
  await logDocumentAccess(documentId, userId, 'DELETE');

  logger.info('Document deleted', { documentId, userId });

  return { success: true };
};

// =============================================================================
// AUDIT LOGGING
// =============================================================================

/**
 * Log document access
 * @param {string} documentId - Document ID
 * @param {string} userId - User ID
 * @param {string} action - Action type
 * @param {Object} details - Additional details
 */
const logDocumentAccess = async (documentId, userId, action, details = {}) => {
  await prisma.documentAuditLog.create({
    data: {
      documentId,
      userId,
      action,
      details,
      ip: details.ip,
      userAgent: details.userAgent,
    },
  });
};

/**
 * Get document audit log
 * @param {string} documentId - Document ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Array>} Audit log
 */
const getDocumentAuditLog = async (documentId, businessId) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document || document.businessId !== businessId) {
    throw new ForbiddenError('Access denied');
  }

  return prisma.documentAuditLog.findMany({
    where: { documentId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Constants
  DOCUMENT_TYPE,
  DOCUMENT_STATUS,
  ACCESS_LEVEL,
  // Upload & management
  uploadDocument,
  getDocument,
  getDocuments,
  deleteDocument,
  downloadDocument,
  processDownloadToken,
  // Access control
  grantAccess,
  revokeAccess,
  getAccessGrants,
  checkDocumentAccess,
  // Audit
  logDocumentAccess,
  getDocumentAuditLog,
  // Utilities
  validateFile,
  calculateChecksum,
};
