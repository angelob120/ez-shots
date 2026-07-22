-- Add the PENDING status.
-- This MUST be alone in its own migration: Postgres will not let a new enum
-- value be used (e.g. as a column default) in the same transaction that adds it.
ALTER TYPE "RestaurantStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'ACTIVE';
