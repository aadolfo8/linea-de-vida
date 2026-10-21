-- A folder date that covers only its own folder but replaces camera dates too.
ALTER TYPE "FolderDateRuleScope" ADD VALUE IF NOT EXISTS 'DIRECT_OVERRIDE';
