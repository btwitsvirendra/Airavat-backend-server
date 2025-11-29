#!/bin/bash

# =============================================================================
# AIRAVAT B2B MARKETPLACE - DEPLOYMENT SCRIPT
# Automated deployment to production/staging
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-staging}
DOCKER_REGISTRY=${DOCKER_REGISTRY:-"your-registry.com"}
APP_NAME="airavat-api"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Airavat Backend Deployment Script  ${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Check environment
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
  echo -e "${RED}Error: Invalid environment. Use 'staging' or 'production'${NC}"
  exit 1
fi

echo -e "${YELLOW}Deploying to: $ENVIRONMENT${NC}"
echo ""

# =============================================================================
# PRE-DEPLOYMENT CHECKS
# =============================================================================

echo -e "${BLUE}[1/7] Running pre-deployment checks...${NC}"

# Check if required tools are installed
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Docker is required but not installed.${NC}" >&2; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo -e "${RED}Docker Compose is required but not installed.${NC}" >&2; exit 1; }

# Check if .env file exists
if [ ! -f ".env.${ENVIRONMENT}" ]; then
  echo -e "${RED}Error: .env.${ENVIRONMENT} file not found${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Pre-deployment checks passed${NC}"
echo ""

# =============================================================================
# RUN TESTS
# =============================================================================

echo -e "${BLUE}[2/7] Running tests...${NC}"

npm run test:ci || {
  echo -e "${RED}Tests failed. Aborting deployment.${NC}"
  exit 1
}

echo -e "${GREEN}✓ Tests passed${NC}"
echo ""

# =============================================================================
# BUILD DOCKER IMAGE
# =============================================================================

echo -e "${BLUE}[3/7] Building Docker image...${NC}"

IMAGE_TAG="${DOCKER_REGISTRY}/${APP_NAME}:${ENVIRONMENT}-${TIMESTAMP}"
LATEST_TAG="${DOCKER_REGISTRY}/${APP_NAME}:${ENVIRONMENT}-latest"

docker build \
  --build-arg NODE_ENV=${ENVIRONMENT} \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  -t ${IMAGE_TAG} \
  -t ${LATEST_TAG} \
  .

echo -e "${GREEN}✓ Docker image built: ${IMAGE_TAG}${NC}"
echo ""

# =============================================================================
# PUSH TO REGISTRY
# =============================================================================

echo -e "${BLUE}[4/7] Pushing to registry...${NC}"

docker push ${IMAGE_TAG}
docker push ${LATEST_TAG}

echo -e "${GREEN}✓ Images pushed to registry${NC}"
echo ""

# =============================================================================
# DATABASE MIGRATIONS
# =============================================================================

echo -e "${BLUE}[5/7] Running database migrations...${NC}"

# Load environment variables
export $(cat .env.${ENVIRONMENT} | grep -v '^#' | xargs)

npx prisma migrate deploy

echo -e "${GREEN}✓ Migrations completed${NC}"
echo ""

# =============================================================================
# DEPLOY TO SERVER
# =============================================================================

echo -e "${BLUE}[6/7] Deploying to server...${NC}"

if [ "$ENVIRONMENT" == "production" ]; then
  # Production deployment (example with Docker Swarm)
  docker service update \
    --image ${IMAGE_TAG} \
    --update-parallelism 1 \
    --update-delay 30s \
    ${APP_NAME}
else
  # Staging deployment (example with docker-compose)
  docker-compose -f docker-compose.${ENVIRONMENT}.yml pull
  docker-compose -f docker-compose.${ENVIRONMENT}.yml up -d --force-recreate
fi

echo -e "${GREEN}✓ Deployment completed${NC}"
echo ""

# =============================================================================
# POST-DEPLOYMENT VERIFICATION
# =============================================================================

echo -e "${BLUE}[7/7] Verifying deployment...${NC}"

# Wait for service to start
sleep 10

# Health check
HEALTH_URL="http://localhost:3000/health"
if [ "$ENVIRONMENT" == "production" ]; then
  HEALTH_URL="https://api.airavat.com/health"
fi

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" ${HEALTH_URL})

if [ "$HTTP_STATUS" == "200" ]; then
  echo -e "${GREEN}✓ Health check passed${NC}"
else
  echo -e "${RED}✗ Health check failed (HTTP $HTTP_STATUS)${NC}"
  echo -e "${YELLOW}Rolling back...${NC}"
  # Add rollback logic here
  exit 1
fi

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Deployment completed successfully!  ${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "Image: ${IMAGE_TAG}"
echo -e "Environment: ${ENVIRONMENT}"
echo -e "Timestamp: ${TIMESTAMP}"
echo ""
