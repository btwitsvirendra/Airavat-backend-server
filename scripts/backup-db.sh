#!/bin/bash
# =============================================================================
# AIRAVAT B2B MARKETPLACE - DATABASE BACKUP SCRIPT
# Automated database backup to S3
# =============================================================================

set -e

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-airavat_db}"
DB_USER="${DB_USER:-airavat}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/backups}"
S3_BUCKET="${S3_BUCKET:-airavat-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Generate filename with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo -e "${YELLOW}Starting database backup...${NC}"
echo "Database: ${DB_NAME}"
echo "Timestamp: ${TIMESTAMP}"

# Create backup
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    --no-owner --no-acl \
    | gzip > "${BACKUP_FILE}"

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo -e "${GREEN}Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})${NC}"

# Upload to S3
if [ -n "${S3_BUCKET}" ]; then
    echo -e "${YELLOW}Uploading to S3...${NC}"
    
    aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/database/${DB_NAME}_${TIMESTAMP}.sql.gz" \
        --storage-class STANDARD_IA
    
    echo -e "${GREEN}Uploaded to S3: s3://${S3_BUCKET}/database/${NC}"
fi

# Clean old local backups
echo -e "${YELLOW}Cleaning old backups (>${RETENTION_DAYS} days)...${NC}"
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete

# Clean old S3 backups
if [ -n "${S3_BUCKET}" ]; then
    # List and delete old backups from S3
    CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d)
    
    aws s3 ls "s3://${S3_BUCKET}/database/" \
        | awk -v cutoff="${CUTOFF_DATE}" '$1 < cutoff {print $4}' \
        | while read -r file; do
            aws s3 rm "s3://${S3_BUCKET}/database/${file}"
            echo "Deleted old backup: ${file}"
        done
fi

# Remove local backup after S3 upload
if [ -n "${S3_BUCKET}" ]; then
    rm -f "${BACKUP_FILE}"
fi

echo -e "${GREEN}Backup completed successfully!${NC}"

# Send notification (optional)
if [ -n "${SLACK_WEBHOOK_URL}" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"✅ Database backup completed: ${DB_NAME} (${BACKUP_SIZE})\"}" \
        "${SLACK_WEBHOOK_URL}"
fi
