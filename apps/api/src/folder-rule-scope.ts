import { DatePrecision, FolderDateRuleScope } from '@prisma/client';

/**
 * A folder date rule has two independent choices: does it reach subfolders, and does it replace
 * dates read from the camera / Google Fotos? The stored scope encodes the four combinations.
 */
export type FolderRuleFlags = { includeSubfolders: boolean; overrideCameraDates: boolean };

export const scopeFromFlags = ({
  includeSubfolders,
  overrideCameraDates,
}: FolderRuleFlags): FolderDateRuleScope =>
  includeSubfolders
    ? overrideCameraDates
      ? 'ALL_DESCENDANTS'
      : 'FALLBACK_DESCENDANTS'
    : overrideCameraDates
      ? 'DIRECT_OVERRIDE'
      : 'DIRECT_ONLY';

export const flagsFromScope = (scope: FolderDateRuleScope): FolderRuleFlags => ({
  includeSubfolders: inheritsToSubfolders(scope),
  overrideCameraDates: overridesDetectedDates(scope),
});

/** Whether photos in subfolders of the rule's folder are covered. */
export const inheritsToSubfolders = (scope: FolderDateRuleScope) =>
  scope !== 'DIRECT_ONLY' && scope !== 'DIRECT_OVERRIDE';

/** Whether the rule replaces EXIF, Drive, Takeout and file-name dates, not just fills gaps. */
export const overridesDetectedDates = (scope: FolderDateRuleScope) =>
  scope === 'ALL_DESCENDANTS' || scope === 'DIRECT_OVERRIDE';

type RuleFolder<R> = { parentId: string | null; dateRule: R | null };

/** An indexed folder with the date rule that may apply to its photos. */
export type FolderWithRule = RuleFolder<{
  dateValue: Date;
  precision: DatePrecision;
  scope: FolderDateRuleScope;
}>;

/** The rule that applies to a photo in `folderId`: its own folder's, else the nearest inheriting ancestor's. */
export function applicableRule<R extends { scope: FolderDateRuleScope }>(
  folders: Map<string, RuleFolder<R>>,
  folderId: string | null,
): R | null {
  let currentId = folderId;
  let direct = true;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = folders.get(currentId);
    if (!folder) return null;
    if (folder.dateRule && (direct || inheritsToSubfolders(folder.dateRule.scope)))
      return folder.dateRule;
    direct = false;
    currentId = folder.parentId;
  }
  return null;
}
