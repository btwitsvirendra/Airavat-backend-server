// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADVANCED COMPRESSION MIDDLEWARE
// Supports gzip and brotli compression with intelligent content-type detection
// =============================================================================

const compression = require('compression');
const zlib = require('zlib');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Content types that should be compressed
 */
const COMPRESSIBLE_TYPES = [
  'text/html',
  'text/css',
  'text/plain',
  'text/xml',
  'text/javascript',
  'application/json',
  'application/javascript',
  'application/x-javascript',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/xhtml+xml',
  'application/x-font-ttf',
  'application/x-font-opentype',
  'application/vnd.ms-fontobject',
  'image/svg+xml',
  'image/x-icon',
];

/**
 * Paths that should skip compression
 */
const SKIP_PATHS = [
  '/health',
  '/health/live',
  '/health/ready',
  '/ping',
  '/favicon.ico',
  '/api/v1/webhooks',
];

/**
 * Check if content type is compressible
 * @param {string} contentType - Content type header
 * @returns {boolean}
 */
function isCompressible(contentType) {
  if (!contentType) return false;
  
  const type = contentType.split(';')[0].trim().toLowerCase();
  return COMPRESSIBLE_TYPES.some(compressible => type.includes(compressible));
}

/**
 * Check if response should be compressed
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {boolean}
 */
function shouldCompress(req, res) {
  // Skip if client doesn't accept compression
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding) return false;

  // Skip if no-compression header is set
  if (req.headers['x-no-compression']) return false;

  // Skip specific paths
  if (SKIP_PATHS.some(path => req.path.startsWith(path))) return false;

  // Skip if response is already compressed
  if (res.getHeader('Content-Encoding')) return false;

  // Skip for small responses (overhead not worth it)
  const contentLength = res.getHeader('Content-Length');
  if (contentLength && parseInt(contentLength) < 1024) return false;

  // Use default compression filter for content type check
  return compression.filter(req, res);
}

/**
 * Get best compression method based on Accept-Encoding header
 * @param {string} acceptEncoding - Accept-Encoding header value
 * @returns {string} - 'br' for brotli, 'gzip' for gzip, or null
 */
function getBestEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;

  const encodings = acceptEncoding.toLowerCase();

  // Prefer Brotli if available (better compression)
  if (encodings.includes('br')) {
    return 'br';
  }

  // Fall back to gzip
  if (encodings.includes('gzip')) {
    return 'gzip';
  }

  // Deflate as last resort
  if (encodings.includes('deflate')) {
    return 'deflate';
  }

  return null;
}

// =============================================================================
// COMPRESSION OPTIONS
// =============================================================================

/**
 * Gzip compression options
 */
const gzipOptions = {
  filter: shouldCompress,
  level: 6, // Balanced between speed and compression ratio
  threshold: 1024, // Only compress responses larger than 1KB
  memLevel: 8, // Memory usage (1-9, default 8)
  windowBits: 15, // Window size (8-15)
};

/**
 * Brotli compression options
 */
const brotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_QUALITY]: 4, // Quality (0-11), 4 is good balance
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: 0, // Unknown size
  },
};

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Standard compression middleware (gzip only)
 * Used when Brotli is not available
 */
const standardCompression = compression(gzipOptions);

/**
 * Advanced compression middleware with Brotli support
 * Automatically selects best compression based on client support
 */
function advancedCompression(options = {}) {
  const {
    enableBrotli = true,
    brotliQuality = 4,
    gzipLevel = 6,
    threshold = 1024,
    skipPaths = SKIP_PATHS,
  } = options;

  return (req, res, next) => {
    // Skip compression for certain paths
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Skip if client doesn't want compression
    if (req.headers['x-no-compression']) {
      return next();
    }

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const encoding = getBestEncoding(acceptEncoding);

    // No compression if client doesn't support any encoding
    if (!encoding) {
      return next();
    }

    // Store original write and end methods
    const originalWrite = res.write;
    const originalEnd = res.end;
    const chunks = [];
    let contentType = '';

    // Override write to collect chunks
    res.write = function(chunk, encoding, callback) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }
      // Don't call original write yet - we'll compress at end
      if (typeof encoding === 'function') {
        callback = encoding;
      }
      if (callback) callback();
      return true;
    };

    // Override end to compress and send
    res.end = function(chunk, encoding, callback) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }

      // Get content type from headers
      contentType = res.getHeader('Content-Type') || '';

      // Check if we should compress
      const body = Buffer.concat(chunks);
      
      // Skip if body is too small
      if (body.length < threshold) {
        res.write = originalWrite;
        res.end = originalEnd;
        return res.end(body, encoding, callback);
      }

      // Skip if content type is not compressible
      if (!isCompressible(contentType)) {
        res.write = originalWrite;
        res.end = originalEnd;
        return res.end(body, encoding, callback);
      }

      // Compress based on encoding
      const compressAsync = (data) => {
        return new Promise((resolve, reject) => {
          if (encoding === 'br' && enableBrotli) {
            const brotliOpts = {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality,
              },
            };
            zlib.brotliCompress(data, brotliOpts, (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          } else if (encoding === 'gzip') {
            zlib.gzip(data, { level: gzipLevel }, (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          } else if (encoding === 'deflate') {
            zlib.deflate(data, { level: gzipLevel }, (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          } else {
            resolve(data);
          }
        });
      };

      compressAsync(body)
        .then((compressed) => {
          // Set compression headers
          res.setHeader('Content-Encoding', encoding);
          res.setHeader('Vary', 'Accept-Encoding');
          res.removeHeader('Content-Length');
          res.setHeader('Content-Length', compressed.length);

          // Add compression stats header (for debugging)
          const ratio = ((1 - compressed.length / body.length) * 100).toFixed(1);
          res.setHeader('X-Compression-Ratio', `${ratio}%`);

          // Restore original methods and send
          res.write = originalWrite;
          res.end = originalEnd;
          res.end(compressed, callback);
        })
        .catch((err) => {
          // On error, send uncompressed
          console.error('Compression error:', err);
          res.write = originalWrite;
          res.end = originalEnd;
          res.end(body, encoding, callback);
        });

      // For async handling
      return true;
    };

    next();
  };
}

/**
 * Static file compression middleware
 * Pre-compresses common static file types
 */
function staticCompression(options = {}) {
  return (req, res, next) => {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    // Check if brotli pre-compressed file exists
    if (acceptEncoding.includes('br')) {
      const brotliFile = req.path + '.br';
      // Would check for file existence here
      res.setHeader('Content-Encoding', 'br');
    } else if (acceptEncoding.includes('gzip')) {
      const gzipFile = req.path + '.gz';
      // Would check for file existence here
      res.setHeader('Content-Encoding', 'gzip');
    }

    next();
  };
}

/**
 * Compression stats middleware
 * Adds compression statistics to response headers
 */
function compressionStats() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function(data) {
      const jsonString = JSON.stringify(data);
      const originalSize = Buffer.byteLength(jsonString, 'utf8');

      // Add size header
      res.setHeader('X-Original-Size', originalSize);

      return originalJson(data);
    };

    next();
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  standardCompression,
  advancedCompression,
  staticCompression,
  compressionStats,
  isCompressible,
  shouldCompress,
  getBestEncoding,
  COMPRESSIBLE_TYPES,
  SKIP_PATHS,
};



