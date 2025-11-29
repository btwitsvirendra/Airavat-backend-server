// =============================================================================
// AIRAVAT B2B MARKETPLACE - BULK UPLOAD SERVICE
// Products, Inventory, and Prices via Excel/CSV
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const { Readable } = require('stream');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const { generateSlug } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const JOB_STATUS = { PENDING: 'PENDING', PROCESSING: 'PROCESSING', COMPLETED: 'COMPLETED', PARTIAL: 'PARTIAL', FAILED: 'FAILED' };
const JOB_TYPE = { PRODUCTS: 'products', INVENTORY: 'inventory', PRICES: 'prices' };
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const BATCH_SIZE = 100;

const TEMPLATES = {
  [JOB_TYPE.PRODUCTS]: {
    headers: ['name', 'sku', 'description', 'category', 'price', 'max_price', 'moq', 'hsn_code', 'gst_rate', 'unit'],
    required: ['name', 'sku', 'price'],
    sample: [['Premium Cotton T-Shirt', 'SKU-001', 'High quality cotton t-shirt', 'Clothing', '299', '399', '10', '61091000', '12', 'pieces']],
  },
  [JOB_TYPE.INVENTORY]: {
    headers: ['sku', 'stock', 'reserved', 'reorder_point'],
    required: ['sku', 'stock'],
    sample: [['SKU-001', '100', '10', '20']],
  },
  [JOB_TYPE.PRICES]: {
    headers: ['sku', 'price', 'mrp', 'compare_price'],
    required: ['sku', 'price'],
    sample: [['SKU-001', '299', '399', '499']],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const normalizeHeader = (header) => header.toLowerCase().trim().replace(/\s+/g, '_');

const validateFile = (file) => {
  if (!file) throw new BadRequestError('No file uploaded');
  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new BadRequestError(`Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  if (file.size > MAX_FILE_SIZE) throw new BadRequestError(`File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
};

const parseCSV = (buffer) => {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
      .pipe(csv({ mapHeaders: ({ header }) => normalizeHeader(header) }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
};

const parseExcel = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) normalized[normalizeHeader(key)] = value;
    return normalized;
  });
};

const parseFile = async (file) => {
  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  return ext === '.csv' ? parseCSV(file.buffer) : parseExcel(file.buffer);
};

const validateRow = (row, jobType) => {
  const template = TEMPLATES[jobType];
  const errors = [];
  for (const field of template.required) {
    if (!row[field] || row[field].toString().trim() === '') errors.push(`Missing required field: ${field}`);
  }
  return { valid: errors.length === 0, errors };
};

// =============================================================================
// PRODUCT UPLOAD
// =============================================================================

const processProductUpload = async (businessId, userId, file, options = {}) => {
  validateFile(file);

  const job = await prisma.bulkUploadJob.create({
    data: { businessId, userId, jobType: JOB_TYPE.PRODUCTS, fileName: file.originalname, fileUrl: '', fileSize: file.size, status: JOB_STATUS.PENDING },
  });

  logger.info('Product upload job created', { jobId: job.id, businessId, fileName: file.originalname });

  try {
    const rows = await parseFile(file);
    await prisma.bulkUploadJob.update({ where: { id: job.id }, data: { totalRows: rows.length, status: JOB_STATUS.PROCESSING, startedAt: new Date() } });
    emitToBusiness(businessId, 'bulkupload:started', { jobId: job.id, totalRows: rows.length });

    const results = { processed: 0, success: 0, errors: [], created: [], updated: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const validation = validateRow(row, JOB_TYPE.PRODUCTS);
        if (!validation.valid) { results.errors.push({ row: i + 2, sku: row.sku, errors: validation.errors }); results.processed++; continue; }

        const existingProduct = await prisma.product.findFirst({ where: { businessId, sku: row.sku } });
        const productData = {
          name: row.name, sku: row.sku, description: row.description || '',
          minPrice: parseFloat(row.price) || 0, maxPrice: parseFloat(row.max_price) || parseFloat(row.price) || 0,
          minOrderQuantity: parseInt(row.moq) || 1, hsnCode: row.hsn_code || '', gstRate: parseFloat(row.gst_rate) || 18, unit: row.unit || 'pieces',
        };

        if (existingProduct && options.updateExisting) {
          await prisma.product.update({ where: { id: existingProduct.id }, data: productData });
          results.updated.push(row.sku); results.success++;
        } else if (!existingProduct) {
          await prisma.product.create({ data: { ...productData, businessId, slug: generateSlug(row.name), status: 'DRAFT' } });
          results.created.push(row.sku); results.success++;
        }
      } catch (error) { results.errors.push({ row: i + 2, sku: row.sku, error: error.message }); }
      results.processed++;

      if (results.processed % BATCH_SIZE === 0) {
        await prisma.bulkUploadJob.update({ where: { id: job.id }, data: { processedRows: results.processed, successRows: results.success, errorRows: results.errors.length } });
        emitToBusiness(businessId, 'bulkupload:progress', { jobId: job.id, processed: results.processed, total: rows.length, success: results.success, errors: results.errors.length });
      }
    }

    const finalStatus = results.errors.length === 0 ? JOB_STATUS.COMPLETED : results.success > 0 ? JOB_STATUS.PARTIAL : JOB_STATUS.FAILED;
    await prisma.bulkUploadJob.update({
      where: { id: job.id },
      data: { status: finalStatus, processedRows: results.processed, successRows: results.success, errorRows: results.errors.length, errors: results.errors, completedAt: new Date() },
    });

    emitToBusiness(businessId, 'bulkupload:completed', { jobId: job.id, status: finalStatus, success: results.success, errors: results.errors.length });
    logger.info('Product upload completed', { jobId: job.id, status: finalStatus, success: results.success, errors: results.errors.length });

    return { jobId: job.id, ...results };
  } catch (error) {
    await prisma.bulkUploadJob.update({ where: { id: job.id }, data: { status: JOB_STATUS.FAILED, errors: [{ error: error.message }], completedAt: new Date() } });
    logger.error('Product upload failed', { jobId: job.id, error: error.message });
    throw error;
  }
};

// =============================================================================
// JOB MANAGEMENT
// =============================================================================

const getJobs = async (businessId, options = {}) => {
  const { page = 1, limit = 20, jobType, status } = options;
  const skip = (page - 1) * limit;
  const where = { businessId };
  if (jobType) where.jobType = jobType;
  if (status) where.status = status;

  const [jobs, total] = await Promise.all([
    prisma.bulkUploadJob.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.bulkUploadJob.count({ where }),
  ]);

  return { jobs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getJob = async (jobId, businessId) => {
  const job = await prisma.bulkUploadJob.findFirst({ where: { id: jobId, businessId } });
  if (!job) throw new NotFoundError('Upload job');
  return job;
};

const getTemplate = (type) => {
  const template = TEMPLATES[type];
  if (!template) throw new BadRequestError('Invalid template type');
  const csvContent = [template.headers.join(','), ...template.sample.map((row) => row.join(','))].join('\n');
  return { headers: template.headers, required: template.required, sample: template.sample, csvContent, filename: `${type}_template.csv` };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  JOB_STATUS, JOB_TYPE, TEMPLATES,
  processProductUpload, getJobs, getJob, getTemplate, parseFile, validateFile,
};
