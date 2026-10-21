import type { Source } from '../api';

export type Pile = 'undated' | 'yearOnly' | 'dated' | 'hidden';
export const PILES: readonly Pile[] = ['undated', 'yearOnly', 'dated', 'hidden'];

export type PileCounts = {
  undated: number;
  yearOnly: number;
  dated: number;
  hidden: number;
  total: number;
};

export type DatePrecision = 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN';
export type OriginKind = 'camera' | 'google' | 'filename' | 'folder' | 'manual' | 'none';

export type OrderingPhoto = {
  id: string;
  fileName: string;
  thumbnailUrl: string;
  dimensions?: { width: number; height: number };
  effectiveDate: {
    value: string | null;
    precision: DatePrecision;
    origin: string;
    originKind: OriginKind;
  };
  hidden: boolean;
  folderId: string | null;
};

export type PhotoPage = { items: OrderingPhoto[]; nextCursor: string | null };

/** Which photos a request looks at: one source, optionally one folder (and what is below it). */
export type OrderScope = {
  sourceId: string | null;
  folderId: string | null;
  includeSubfolders: boolean;
};

/** A date as the person enters it: the year is required, month and day refine it. */
export type DateDraft = { year: number; month: number | null; day: number | null };

/** The body the API takes for `PUT photos/dates` and for folder dates. */
export type DatePayload = {
  year: number;
  month?: number;
  day?: number;
  precision: 'YEAR' | 'MONTH' | 'DAY';
};

export type FolderDateRule = {
  dateValue: string;
  precision: DatePrecision;
  scope: string;
  includeSubfolders: boolean;
  overrideCameraDates: boolean;
};

export type FolderNode = {
  id: string;
  name: string;
  path: string[];
  parentId: string | null;
  depth: number;
  photoCount: number;
  toDateCount: number;
  subtreePhotoCount: number;
  subtreeToDateCount: number;
  dateRule: FolderDateRule | null;
  children: FolderNode[];
};

export type FolderTree = {
  sourceId: string;
  folderCount: number;
  items: FolderNode[];
  unfiled: { photoCount: number; toDateCount: number };
  totals: { photoCount: number; toDateCount: number };
};

export type FolderDetail = Omit<FolderNode, 'children'> & {
  sourceId: string;
  breadcrumb: Array<{ id: string; name: string }>;
  childFolders: Array<{
    id: string;
    name: string;
    subtreePhotoCount: number;
    subtreeToDateCount: number;
  }>;
};

export type FolderDatePreview = {
  scopePhotoCount: number;
  willChangeCount: number;
  unchangedCount: number;
  preservesManualCount: number;
  replacesAutomaticCount: number;
  replacesFolderNameDateCount: number;
};

export type FolderDateBody = DatePayload & {
  includeSubfolders: boolean;
  overrideCameraDates: boolean;
};

export type FilenameSuggestions = {
  totalCount: number;
  groups: Array<{
    kind: string;
    photoCount: number;
    earliest: string;
    latest: string;
    examples: Array<{ id: string; fileName: string; date: string }>;
  }>;
};

export type PerIdResult = { id: string; status: string };

export type { Source };
