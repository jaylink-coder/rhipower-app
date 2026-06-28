-- Migration: add phase_layout and client_session_id to custom_appliance_suggestions
-- Run this once in Supabase → SQL Editor

ALTER TABLE custom_appliance_suggestions
  ADD COLUMN IF NOT EXISTS phase_layout       TEXT DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS client_session_id  TEXT;
