// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOGGER
// Winston-based logging with multiple transports
// =============================================================================

const winston = require('winston');
const path = require('path');
const config = require('./index');

// Custom log format
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

// Create transports array based on environment
const transports = [
  // Console transport (always enabled)
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      customFormat
    ),
  }),
];

// File transport for production
if (config.app.isProd || config.logging.filePath) {
  const logsDir = path.dirname(config.logging.filePath);
  
  transports.push(
    // Combined log file
    new winston.transports.File({
      filename: config.logging.filePath,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
      ),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
      ),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Add helper methods
logger.logRequest = (req, res, responseTime) => {
  const { method, originalUrl, ip } = req;
  const { statusCode } = res;
  
  const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  
  logger.log(logLevel, `${method} ${originalUrl}`, {
    statusCode,
    responseTime: `${responseTime}ms`,
    ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
  });
};

logger.logError = (error, context = {}) => {
  logger.error(error.message, {
    stack: error.stack,
    code: error.code,
    ...context,
  });
};

logger.logAudit = (action, userId, details = {}) => {
  logger.info(`AUDIT: ${action}`, {
    userId,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

module.exports = logger;
