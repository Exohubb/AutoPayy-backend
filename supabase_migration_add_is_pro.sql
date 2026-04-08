-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Add is_pro column to users table
-- Run this in: Supabase Dashboard → SQL Editor
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Add is_pro column (defaults false for all existing users)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT false;

-- 2. Verify the column was added: 
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'is_pro';

-- ────────────────────────────────────────────────────────────────────────────
-- After running this, users who pay go through:
--   POST /api/payments/verify → supabaseService.upgradeUserToPro()
--   → UPDATE public.users SET is_pro = true WHERE id = '<userId>'
-- ────────────────────────────────────────────────────────────────────────────
