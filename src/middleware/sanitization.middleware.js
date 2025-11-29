// =============================================================================
// AIRAVAT B2B MARKETPLACE - INPUT SANITIZATION MIDDLEWARE
// Advanced input validation, SQL injection and XSS detection
// =============================================================================

const logger = require('../config/logger');
const ipBlockingService = require('../services/ipBlocking.service');

/**
 * SQL Injection patterns
 */
const SQL_INJECTION_PATTERNS = [
  // Basic SQL keywords with suspicious context
  /(\b(union|select|insert|update|delete|drop|alter|create|truncate)\b.*\b(from|into|table|database)\b)/i,
  // Comment injection
  /(--|#|\/\*|\*\/)/,
  // Hex encoding
  /0x[0-9a-fA-F]+/,
  // CHAR() function
  /char\s*\(/i,
  // String concatenation
  /(\|\||\+\s*')/,
  // Benchmark/sleep attacks
  /(benchmark|sleep|waitfor|delay)\s*\(/i,
  // Information schema
  /information_schema/i,
  // sys tables
  /\bsys\b\./i,
  // Quote escaping
  /(\\'|\\"|%27|%22|%00)/,
  // OR/AND with always true/false
  /\b(or|and)\b\s+\d+\s*=\s*\d+/i,
  /\b(or|and)\b\s+['"]?\w+['"]?\s*=\s*['"]?\w+['"]?/i,
  // Subquery patterns
  /\(\s*select\b/i,
  // EXEC/EXECUTE
  /(exec|execute)\s*\(/i,
  // xp_ stored procedures
  /xp_\w+/i,
  // sp_ stored procedures
  /sp_\w+/i,
];

/**
 * XSS Attack patterns
 */
const XSS_PATTERNS = [
  // Script tags
  /<script\b[^>]*>(.*?)<\/script>/gi,
  /<script\b[^>]*>/gi,
  // Event handlers
  /\bon\w+\s*=/gi,
  // JavaScript protocol
  /javascript\s*:/gi,
  // VBScript protocol
  /vbscript\s*:/gi,
  // Data URLs with scripts
  /data\s*:\s*text\/html/gi,
  // Expression CSS
  /expression\s*\(/gi,
  // Behavior CSS
  /behavior\s*:/gi,
  // Binding CSS
  /-moz-binding/gi,
  // Import CSS
  /@import/gi,
  // Base64 encoded content
  /base64\s*,/gi,
  // SVG with scripts
  /<svg\b[^>]*\bon/gi,
  // Object/Embed tags
  /<(object|embed|applet|iframe|frame|frameset|layer|bgsound|base)\b/gi,
  // Form action injection
  /<form\b[^>]*action\s*=/gi,
  // Meta refresh
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/gi,
  // Link with external resources
  /<link\b[^>]*href\s*=\s*["']?(?!#)/gi,
  // Style with expression
  /<style\b[^>]*>[^<]*expression\s*\(/gi,
  // HTML entities that could be XSS
  /&#x?[0-9a-fA-F]+;/g,
];

/**
 * Path traversal patterns
 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g,
  /\.\.\\/, 
  /%2e%2e%2f/gi,
  /%2e%2e\//gi,
  /\.%2e\//gi,
  /%2e\.\//gi,
  /\.\.%2f/gi,
  /%2e%2e%5c/gi,
  /\.\.%5c/gi,
  /%252e%252e%252f/gi,
  /etc\/passwd/gi,
  /etc\/shadow/gi,
  /windows\/system32/gi,
  /boot\.ini/gi,
  /proc\/self/gi,
];

/**
 * Command injection patterns
 */
const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$]/,
  /\$\(/,
  /\$\{/,
  /`[^`]*`/,
  /\|\s*\w+/,
  /;\s*\w+/,
  /&&\s*\w+/,
  /\|\|\s*\w+/,
  />\s*\/\w+/,
  /<\s*\/\w+/,
  /\n\s*\w+/,
  /\r\s*\w+/,
];

/**
 * LDAP injection patterns
 */
const LDAP_INJECTION_PATTERNS = [
  /[()\\*]/,
  /\x00/,
  /\|/,
  /!/,
];

/**
 * Check for SQL injection
 */
function detectSQLInjection(input) {
  if (typeof input !== 'string') return { detected: false };

  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return {
        detected: true,
        pattern: pattern.toString(),
        input: input.substring(0, 100),
      };
    }
  }

  return { detected: false };
}

/**
 * Check for XSS
 */
function detectXSS(input) {
  if (typeof input !== 'string') return { detected: false };

  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(input)) {
      return {
        detected: true,
        pattern: pattern.toString(),
        input: input.substring(0, 100),
      };
    }
  }

  return { detected: false };
}

/**
 * Check for path traversal
 */
function detectPathTraversal(input) {
  if (typeof input !== 'string') return { detected: false };

  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(input)) {
      return {
        detected: true,
        pattern: pattern.toString(),
        input: input.substring(0, 100),
      };
    }
  }

  return { detected: false };
}

/**
 * Check for command injection
 */
function detectCommandInjection(input) {
  if (typeof input !== 'string') return { detected: false };

  for (const pattern of COMMAND_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return {
        detected: true,
        pattern: pattern.toString(),
        input: input.substring(0, 100),
      };
    }
  }

  return { detected: false };
}

/**
 * Sanitize string input
 */
function sanitizeString(input) {
  if (typeof input !== 'string') return input;

  return input
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove script tags
    .replace(/<script\b[^>]*>(.*?)<\/script>/gi, '')
    // Remove event handlers
    .replace(/\bon\w+\s*=/gi, '')
    // Remove javascript: protocol
    .replace(/javascript\s*:/gi, '')
    // Encode HTML entities
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    // Trim whitespace
    .trim();
}

/**
 * Deep sanitize object
 */
function sanitizeObject(obj, options = {}) {
  const { maxDepth = 10, currentDepth = 0 } = options;

  if (currentDepth > maxDepth) {
    return obj;
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, { ...options, currentDepth: currentDepth + 1 }));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize key as well
      const sanitizedKey = sanitizeString(key);
      sanitized[sanitizedKey] = sanitizeObject(value, { ...options, currentDepth: currentDepth + 1 });
    }
    return sanitized;
  }

  return obj;
}

/**
 * Validate and scan all inputs
 */
function scanInputs(data) {
  const results = {
    sqlInjection: [],
    xss: [],
    pathTraversal: [],
    commandInjection: [],
  };

  const scan = (value, path = '') => {
    if (typeof value === 'string') {
      const sqlResult = detectSQLInjection(value);
      if (sqlResult.detected) {
        results.sqlInjection.push({ path, ...sqlResult });
      }

      const xssResult = detectXSS(value);
      if (xssResult.detected) {
        results.xss.push({ path, ...xssResult });
      }

      const pathResult = detectPathTraversal(value);
      if (pathResult.detected) {
        results.pathTraversal.push({ path, ...pathResult });
      }

      const cmdResult = detectCommandInjection(value);
      if (cmdResult.detected) {
        results.commandInjection.push({ path, ...cmdResult });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([key, val]) => {
        scan(val, path ? `${path}.${key}` : key);
      });
    }
  };

  scan(data);

  return {
    safe: Object.values(results).every((arr) => arr.length === 0),
    results,
  };
}

/**
 * Input sanitization middleware
 */
function sanitizationMiddleware(options = {}) {
  const {
    sanitize = true,
    blockOnThreat = true,
    logThreats = true,
    trackSuspicious = true,
    excludePaths = [],
    excludeFields = ['password', 'token'],
  } = options;

  return async (req, res, next) => {
    // Skip excluded paths
    if (excludePaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    const ip = req.clientIP || req.ip;
    const inputData = { ...req.body, ...req.query, ...req.params };

    // Remove excluded fields from scanning
    for (const field of excludeFields) {
      delete inputData[field];
    }

    // Scan for threats
    const scanResult = scanInputs(inputData);

    if (!scanResult.safe) {
      const threats = [];

      if (scanResult.results.sqlInjection.length > 0) {
        threats.push('SQL Injection');
      }
      if (scanResult.results.xss.length > 0) {
        threats.push('XSS');
      }
      if (scanResult.results.pathTraversal.length > 0) {
        threats.push('Path Traversal');
      }
      if (scanResult.results.commandInjection.length > 0) {
        threats.push('Command Injection');
      }

      // Log the threat
      if (logThreats) {
        logger.warn('Security threat detected', {
          ip,
          path: req.path,
          method: req.method,
          threats,
          details: scanResult.results,
          userId: req.user?.id,
        });
      }

      // Track suspicious activity
      if (trackSuspicious) {
        await ipBlockingService.recordSuspiciousActivity(ip, 'injection_attempt', {
          threats,
          path: req.path,
          method: req.method,
        });
      }

      // Block the request
      if (blockOnThreat) {
        return res.status(400).json({
          success: false,
          error: 'Invalid input detected',
          code: 'SECURITY_VIOLATION',
        });
      }
    }

    // Sanitize inputs
    if (sanitize) {
      if (req.body && typeof req.body === 'object') {
        // Preserve password field
        const password = req.body.password;
        req.body = sanitizeObject(req.body);
        if (password) req.body.password = password;
      }

      if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
      }

      if (req.params && typeof req.params === 'object') {
        req.params = sanitizeObject(req.params);
      }
    }

    next();
  };
}

/**
 * File upload sanitization
 */
function sanitizeFilename(filename) {
  return filename
    // Remove path separators
    .replace(/[\/\\]/g, '')
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove special characters
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Prevent double extensions
    .replace(/\.{2,}/g, '.')
    // Limit length
    .substring(0, 255);
}

/**
 * URL sanitization
 */
function sanitizeUrl(url) {
  if (!url) return '';

  try {
    const parsed = new URL(url);

    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Email sanitization
 */
function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') return '';

  return email
    .toLowerCase()
    .trim()
    .replace(/[<>'"]/g, '');
}

/**
 * HTML to plain text
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';

  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim();
}

module.exports = {
  // Detection functions
  detectSQLInjection,
  detectXSS,
  detectPathTraversal,
  detectCommandInjection,
  scanInputs,

  // Sanitization functions
  sanitizeString,
  sanitizeObject,
  sanitizeFilename,
  sanitizeUrl,
  sanitizeEmail,
  stripHtml,

  // Middleware
  sanitizationMiddleware,

  // Patterns for testing
  SQL_INJECTION_PATTERNS,
  XSS_PATTERNS,
  PATH_TRAVERSAL_PATTERNS,
  COMMAND_INJECTION_PATTERNS,
};
