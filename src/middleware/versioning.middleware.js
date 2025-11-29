// =============================================================================
// AIRAVAT B2B MARKETPLACE - API VERSIONING MIDDLEWARE
// Handle API versioning for backward compatibility
// =============================================================================

const logger = require('../config/logger');

/**
 * API Version Configuration
 */
const API_CONFIG = {
  currentVersion: 'v1',
  supportedVersions: ['v1'],
  deprecatedVersions: [],
  sunsetVersions: [],
  
  // Version sunset dates
  sunsetDates: {
    // 'v0': '2024-01-01',
  },
  
  // Default version when none specified
  defaultVersion: 'v1',
  
  // Headers
  headers: {
    version: 'X-API-Version',
    deprecation: 'Deprecation',
    sunset: 'Sunset',
    link: 'Link',
  },
};

/**
 * Version transformers for backward compatibility
 * Transform requests/responses between versions
 */
const versionTransformers = {
  // Example: Transform v0 request to v1 format
  // 'v0_to_v1': {
  //   request: (req) => {
  //     // Transform request body
  //     if (req.body.old_field) {
  //       req.body.newField = req.body.old_field;
  //       delete req.body.old_field;
  //     }
  //     return req;
  //   },
  //   response: (data) => {
  //     // Transform response for old clients
  //     if (data.newField) {
  //       data.old_field = data.newField;
  //     }
  //     return data;
  //   },
  // },
};

/**
 * Parse version from request
 */
function parseVersion(req) {
  // 1. Check URL path (e.g., /api/v1/...)
  const pathMatch = req.path.match(/^\/api\/(v\d+)\//);
  if (pathMatch) {
    return pathMatch[1];
  }

  // 2. Check header
  const headerVersion = req.get(API_CONFIG.headers.version);
  if (headerVersion) {
    return headerVersion.toLowerCase();
  }

  // 3. Check query parameter
  if (req.query.api_version) {
    return req.query.api_version.toLowerCase();
  }

  // 4. Check Accept header (e.g., application/vnd.airavat.v1+json)
  const accept = req.get('Accept');
  if (accept) {
    const acceptMatch = accept.match(/application\/vnd\.airavat\.(v\d+)\+json/);
    if (acceptMatch) {
      return acceptMatch[1];
    }
  }

  return API_CONFIG.defaultVersion;
}

/**
 * Check if version is valid
 */
function isValidVersion(version) {
  return API_CONFIG.supportedVersions.includes(version) ||
    API_CONFIG.deprecatedVersions.includes(version);
}

/**
 * Check if version is deprecated
 */
function isDeprecatedVersion(version) {
  return API_CONFIG.deprecatedVersions.includes(version);
}

/**
 * Check if version is sunset
 */
function isSunsetVersion(version) {
  return API_CONFIG.sunsetVersions.includes(version);
}

/**
 * Get sunset date for version
 */
function getSunsetDate(version) {
  return API_CONFIG.sunsetDates[version];
}

/**
 * API versioning middleware
 */
function versioningMiddleware(options = {}) {
  const { strict = false } = options;

  return (req, res, next) => {
    const version = parseVersion(req);

    // Attach version to request
    req.apiVersion = version;

    // Check if version is sunset (no longer supported)
    if (isSunsetVersion(version)) {
      return res.status(410).json({
        success: false,
        error: 'API version no longer supported',
        code: 'VERSION_SUNSET',
        currentVersion: API_CONFIG.currentVersion,
        message: `API ${version} has been discontinued. Please upgrade to ${API_CONFIG.currentVersion}`,
      });
    }

    // Check if version is valid
    if (!isValidVersion(version)) {
      if (strict) {
        return res.status(400).json({
          success: false,
          error: 'Invalid API version',
          code: 'INVALID_VERSION',
          requestedVersion: version,
          supportedVersions: API_CONFIG.supportedVersions,
        });
      }

      // Use default version
      req.apiVersion = API_CONFIG.defaultVersion;
    }

    // Set response headers
    res.set(API_CONFIG.headers.version, req.apiVersion);

    // Add deprecation headers if version is deprecated
    if (isDeprecatedVersion(version)) {
      const sunsetDate = getSunsetDate(version);

      res.set(API_CONFIG.headers.deprecation, 'true');
      
      if (sunsetDate) {
        res.set(API_CONFIG.headers.sunset, new Date(sunsetDate).toUTCString());
      }

      // Add link to migration docs
      res.set(
        API_CONFIG.headers.link,
        `<https://docs.airavat.com/api/migration/${version}-to-${API_CONFIG.currentVersion}>; rel="successor-version"`
      );

      logger.warn('Deprecated API version used', {
        version,
        path: req.path,
        ip: req.ip,
      });
    }

    next();
  };
}

/**
 * Version-specific route handler wrapper
 */
function versionHandler(handlers) {
  return (req, res, next) => {
    const version = req.apiVersion || API_CONFIG.defaultVersion;
    const handler = handlers[version] || handlers.default;

    if (!handler) {
      return res.status(400).json({
        success: false,
        error: 'Endpoint not available for this API version',
        code: 'VERSION_NOT_SUPPORTED',
        version,
      });
    }

    return handler(req, res, next);
  };
}

/**
 * Transform request/response for version compatibility
 */
function transformForVersion(fromVersion, toVersion) {
  return (req, res, next) => {
    const transformerKey = `${fromVersion}_to_${toVersion}`;
    const transformer = versionTransformers[transformerKey];

    if (!transformer) {
      return next();
    }

    // Transform request
    if (transformer.request) {
      transformer.request(req);
    }

    // Transform response
    if (transformer.response) {
      const originalJson = res.json;
      res.json = function (data) {
        const transformed = transformer.response(data);
        return originalJson.call(this, transformed);
      };
    }

    next();
  };
}

/**
 * Create versioned router
 */
function createVersionedRouter(express) {
  const router = express.Router();

  router.use(versioningMiddleware());

  // Add version-specific routing
  router.v = (version, path, ...handlers) => {
    router.use(path, (req, res, next) => {
      if (req.apiVersion === version) {
        return handlers[0](req, res, next);
      }
      next();
    });
  };

  return router;
}

/**
 * Version compatibility layer
 */
class VersionCompatibility {
  constructor() {
    this.adapters = new Map();
  }

  /**
   * Register version adapter
   */
  register(fromVersion, toVersion, adapter) {
    const key = `${fromVersion}:${toVersion}`;
    this.adapters.set(key, adapter);
  }

  /**
   * Adapt request from one version to another
   */
  adaptRequest(req, fromVersion, toVersion) {
    const key = `${fromVersion}:${toVersion}`;
    const adapter = this.adapters.get(key);

    if (adapter && adapter.request) {
      return adapter.request(req);
    }

    return req;
  }

  /**
   * Adapt response from one version to another
   */
  adaptResponse(data, fromVersion, toVersion) {
    const key = `${toVersion}:${fromVersion}`; // Reverse for response
    const adapter = this.adapters.get(key);

    if (adapter && adapter.response) {
      return adapter.response(data);
    }

    return data;
  }
}

/**
 * API changelog
 */
const changelog = {
  v1: {
    released: '2024-01-01',
    changes: [
      'Initial release',
      'Authentication endpoints',
      'Business management',
      'Product catalog',
      'Order management',
      'RFQ system',
      'Chat integration',
    ],
  },
  // Future versions would be added here
  // v2: {
  //   released: '2025-01-01',
  //   changes: [
  //     'Breaking: Changed user object structure',
  //     'Added: GraphQL support',
  //     'Improved: Pagination using cursors',
  //   ],
  // },
};

/**
 * Get API info
 */
function getApiInfo() {
  return {
    name: 'Airavat B2B Marketplace API',
    currentVersion: API_CONFIG.currentVersion,
    supportedVersions: API_CONFIG.supportedVersions,
    deprecatedVersions: API_CONFIG.deprecatedVersions,
    documentation: 'https://docs.airavat.com/api',
    changelog,
  };
}

/**
 * Version comparison utility
 */
function compareVersions(v1, v2) {
  const n1 = parseInt(v1.replace('v', ''));
  const n2 = parseInt(v2.replace('v', ''));
  return n1 - n2;
}

module.exports = {
  API_CONFIG,
  parseVersion,
  isValidVersion,
  isDeprecatedVersion,
  isSunsetVersion,
  getSunsetDate,
  versioningMiddleware,
  versionHandler,
  transformForVersion,
  createVersionedRouter,
  VersionCompatibility,
  getApiInfo,
  compareVersions,
};
