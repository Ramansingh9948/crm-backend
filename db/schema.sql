-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop tables if exist
DROP TABLE IF EXISTS communications CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- Customers table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    city VARCHAR(100),
    channel_affinity VARCHAR(50) DEFAULT 'email', -- email, whatsapp, sms, rcs
    churn_risk NUMERIC(3, 2) DEFAULT 0.0, -- 0.0 to 1.0
    purchase_propensity NUMERIC(3, 2) DEFAULT 0.0, -- 0.0 to 1.0
    total_spent NUMERIC(10, 2) DEFAULT 0.00,
    total_orders INTEGER DEFAULT 0,
    avg_order_value NUMERIC(10, 2) DEFAULT 0.00,
    last_order_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaigns table
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    goal TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'draft', -- draft, running, completed
    ai_reasoning TEXT,
    total_targeted INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    launched_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    ai_debrief TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL,
    items VARCHAR(255),
    ordered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Communications table
CREATE TABLE communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    ai_reason TEXT,
    status VARCHAR(50) DEFAULT 'queued', -- queued, sent, delivered, opened, clicked, failed
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    replied_at TIMESTAMP WITH TIME ZONE,
    customer_reply TEXT,
    converted_at TIMESTAMP WITH TIME ZONE,
    conversion_amount NUMERIC(10, 2)
);
