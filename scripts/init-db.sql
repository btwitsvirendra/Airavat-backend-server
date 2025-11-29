-- =============================================================================
-- AIRAVAT B2B MARKETPLACE - DATABASE INITIALIZATION
-- PostgreSQL initialization script
-- =============================================================================

-- Create database if not exists (run separately as postgres superuser)
-- CREATE DATABASE airavat_db;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- =============================================================================
-- CUSTOM FUNCTIONS
-- =============================================================================

-- Function to generate slug from text
CREATE OR REPLACE FUNCTION generate_slug(text_input TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(
        unaccent(text_input),
        '[^a-zA-Z0-9\s-]', '', 'g'
      ),
      '[\s-]+', '-', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to generate unique order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  new_number TEXT;
  counter INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 5) AS INTEGER)), 0) + 1
  INTO counter
  FROM orders
  WHERE order_number LIKE 'ORD-%'
    AND created_at >= date_trunc('year', CURRENT_DATE);
  
  new_number := 'ORD-' || to_char(CURRENT_DATE, 'YYMM') || '-' || LPAD(counter::TEXT, 6, '0');
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate business trust score
CREATE OR REPLACE FUNCTION calculate_trust_score(business_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  score DECIMAL := 0;
  verification_score DECIMAL := 0;
  rating_score DECIMAL := 0;
  order_score DECIMAL := 0;
  response_score DECIMAL := 0;
  business_record RECORD;
BEGIN
  SELECT 
    b.verification_status,
    b.average_rating,
    b.total_reviews,
    COUNT(DISTINCT o.id) as order_count,
    AVG(CASE WHEN o.status = 'DELIVERED' THEN 1 ELSE 0 END) * 100 as fulfillment_rate
  INTO business_record
  FROM businesses b
  LEFT JOIN orders o ON o.seller_id = b.id
  WHERE b.id = business_id
  GROUP BY b.id, b.verification_status, b.average_rating, b.total_reviews;
  
  -- Verification (30%)
  IF business_record.verification_status = 'VERIFIED' THEN
    verification_score := 30;
  ELSIF business_record.verification_status = 'PENDING' THEN
    verification_score := 10;
  END IF;
  
  -- Rating (25%)
  rating_score := COALESCE(business_record.average_rating, 0) * 5;
  
  -- Orders (25%)
  order_score := LEAST(COALESCE(business_record.order_count, 0) / 10.0, 1) * 25;
  
  -- Fulfillment (20%)
  response_score := COALESCE(business_record.fulfillment_rate, 0) * 0.2;
  
  score := verification_score + rating_score + order_score + response_score;
  
  RETURN LEAST(GREATEST(score, 0), 100);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- INDEXES FOR SEARCH OPTIMIZATION
-- =============================================================================

-- Full-text search indexes (after Prisma creates tables)
-- Run these after prisma migrate

-- CREATE INDEX IF NOT EXISTS idx_products_search ON products 
--   USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || COALESCE(brand, '')));

-- CREATE INDEX IF NOT EXISTS idx_businesses_search ON businesses 
--   USING gin(to_tsvector('english', business_name || ' ' || COALESCE(description, '')));

-- Trigram indexes for fuzzy search
-- CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin(name gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_businesses_name_trgm ON businesses USING gin(business_name gin_trgm_ops);

-- =============================================================================
-- MATERIALIZED VIEWS FOR ANALYTICS
-- =============================================================================

-- Daily sales summary (refresh periodically)
-- CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_sales AS
-- SELECT 
--   DATE(created_at) as sale_date,
--   seller_id,
--   COUNT(*) as order_count,
--   SUM(total_amount) as total_revenue,
--   AVG(total_amount) as avg_order_value
-- FROM orders
-- WHERE status NOT IN ('CANCELLED', 'REFUNDED')
-- GROUP BY DATE(created_at), seller_id;

-- CREATE UNIQUE INDEX ON mv_daily_sales (sale_date, seller_id);

-- =============================================================================
-- SCHEDULED FUNCTIONS (FOR CRON JOBS)
-- =============================================================================

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup abandoned carts
CREATE OR REPLACE FUNCTION cleanup_abandoned_carts()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM carts 
  WHERE status = 'ACTIVE' 
    AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
    AND user_id IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to update product organic scores
CREATE OR REPLACE FUNCTION update_organic_scores()
RETURNS VOID AS $$
BEGIN
  UPDATE products p
  SET organic_score = (
    COALESCE(average_rating, 0) * 20 +
    LEAST(review_count * 2, 30) +
    LEAST(order_count * 0.5, 25) +
    CASE WHEN EXISTS (
      SELECT 1 FROM businesses b 
      WHERE b.id = p.business_id AND b.verification_status = 'VERIFIED'
    ) THEN 15 ELSE 0 END +
    LEAST(view_count * 0.01, 10)
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ROW LEVEL SECURITY (Optional - for multi-tenant)
-- =============================================================================

-- Enable RLS on sensitive tables
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE business_documents ENABLE ROW LEVEL SECURITY;

-- Policies would be added based on application user context

-- =============================================================================
-- GRANT PERMISSIONS
-- =============================================================================

-- Create application user (if not using default)
-- CREATE USER airavat_app WITH PASSWORD 'secure_password';

-- Grant permissions
-- GRANT CONNECT ON DATABASE airavat_db TO airavat_app;
-- GRANT USAGE ON SCHEMA public TO airavat_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO airavat_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO airavat_app;

-- Grant execute on functions
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO airavat_app;

-- =============================================================================
-- AUDIT LOGGING TABLE (Optional)
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name VARCHAR(100) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL, -- INSERT, UPDATE, DELETE
  old_data JSONB,
  new_data JSONB,
  user_id UUID,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_record ON audit_logs(record_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (table_name, record_id, action, new_data)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply audit trigger to important tables (uncomment as needed)
-- CREATE TRIGGER audit_orders AFTER INSERT OR UPDATE OR DELETE ON orders
--   FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
-- CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
--   FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

COMMIT;
