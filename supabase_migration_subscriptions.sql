-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Add subscription tracking columns to users table
-- Run this in the Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════════════

-- Add pro_date: timestamp when user upgraded to Pro (auto-set on upgrade)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pro_date TIMESTAMPTZ DEFAULT NULL;

-- Add pro_canceled: timestamp when user cancelled their Pro subscription
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pro_canceled TIMESTAMPTZ DEFAULT NULL;

-- Add subscription_id: Razorpay subscription ID (sub_xxx) for the active subscription
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_id TEXT DEFAULT NULL;

-- Add plan_type: 'monthly' or 'yearly' to track which plan the user is on
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT NULL;

-- ── Back-fill pro_date for existing Pro users (set to now if already Pro) ──
UPDATE users
  SET pro_date = NOW()
  WHERE is_pro = TRUE AND pro_date IS NULL;

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_is_pro ON users(is_pro);
CREATE INDEX IF NOT EXISTS idx_users_subscription_id ON users(subscription_id);

-- ── Verify ────────────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('is_pro', 'pro_date', 'pro_canceled', 'subscription_id', 'plan_type')
ORDER BY column_name;
