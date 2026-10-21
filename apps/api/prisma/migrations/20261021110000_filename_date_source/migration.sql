-- Dates detected from file names (WhatsApp, phone cameras, screenshots).
ALTER TYPE "DateSource" ADD VALUE IF NOT EXISTS 'FILENAME';
