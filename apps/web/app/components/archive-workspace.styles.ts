/** Tailwind utility recipes for the archive workspace's dense management surfaces. */
export const archiveStyles: Record<string, string> = {
  settings:
    'mx-auto min-h-[calc(100dvh-72px)] w-full max-w-[1440px] bg-map-paper px-[clamp(20px,4vw,64px)] pt-14 pb-28 text-map-ink [font-variant-numeric:tabular-nums] [&_h1]:text-balance [&_h2]:text-balance [&_h3]:text-balance [&_p]:leading-relaxed [&_button]:font-inherit [&_input]:font-inherit [&_select]:font-inherit [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-map-ink [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-offset-2 [&_input:focus-visible]:outline-map-ink [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-offset-2 [&_select:focus-visible]:outline-map-ink [&_input:disabled]:cursor-not-allowed [&_select:disabled]:cursor-not-allowed [&_button:disabled]:cursor-not-allowed [&_input:disabled]:opacity-50 [&_select:disabled]:opacity-50 [&_button:disabled]:opacity-50 [&_input]:min-h-11 [&_select]:min-h-11 [&_input]:w-full [&_select]:w-full [&_input]:rounded-lg [&_select]:rounded-lg [&_input]:border [&_select]:border [&_input]:border-map-line [&_select]:border-map-line [&_input]:bg-map-surface [&_select]:bg-map-surface [&_input]:px-3 [&_select]:px-3 [&_input]:text-map-ink [&_select]:text-map-ink [&_input]:transition-colors [&_select]:transition-colors [&_input:hover]:border-map-route [&_select:hover]:border-map-route [&_input:focus]:border-map-route [&_select:focus]:border-map-route [&_input[aria-invalid=true]]:border-map-danger [&_select[aria-invalid=true]]:border-map-danger [&_label]:text-sm [&_label]:font-semibold max-[680px]:px-5 max-[680px]:pt-8 max-[680px]:pb-16',
  intro:
    'max-w-[72ch] py-2 pb-12 [&_h1]:mb-5 [&_h1]:max-w-[18ch] [&_h1]:text-[clamp(2.4rem,5vw,3.5rem)] [&_h1]:font-semibold [&_h1]:leading-none [&_h1]:tracking-[-0.04em] [&_p]:mb-0 [&_p]:max-w-[70ch] [&_p]:text-base',
  taskRail: 'mb-2 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-map-line py-3.5',
  organizeNav:
    'sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-1 border-y border-map-line bg-map-paper py-2 max-[600px]:-mx-5 max-[600px]:px-3',
  organizeTab:
    'inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-semibold text-map-muted transition-colors hover:bg-map-panel hover:text-map-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active',
  organizeTabActive: 'bg-map-route-soft text-map-ink',
  taskPrimary:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-map-active px-4 py-2 text-sm font-semibold text-map-ink no-underline transition-colors hover:bg-map-ink hover:text-map-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active',
  taskLink:
    'inline-flex min-h-11 items-center justify-center gap-2 px-3 py-2 text-sm font-semibold text-map-ink underline-offset-4 hover:text-map-route hover:underline before:size-2 before:rounded-full before:border before:border-map-route before:bg-map-route-soft before:content-[""]',
  notice: 'mb-8 flex items-start gap-3 rounded-lg border border-map-line bg-map-panel px-4 py-3',
  noticeMark: 'mt-1.5 size-2 shrink-0 rounded-full bg-map-active',
  notice_info: 'border-map-line bg-map-panel',
  notice_success: 'border-[#4c8068] bg-map-panel',
  notice_warning: 'border-[#97721d] bg-map-panel [&_span]:bg-[#d49a27]',
  notice_error: 'border-map-danger bg-[#f8e9e4] [&_span]:bg-map-danger',
  connectionSection: 'border-t border-map-line py-10 pb-13',
  sourceSetup: 'border-t border-map-line py-10 pb-13',
  archiveSection: 'border-t border-map-line py-10 pb-13',
  privacySection: 'grid max-w-[78ch] gap-5 border-t border-map-line py-10 pb-13',
  sourcesOverview: 'grid gap-5 border-t border-map-line py-10 pb-13',
  sectionHeading:
    'mb-5 flex flex-wrap items-baseline justify-between gap-3 [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:font-semibold [&_p]:mb-0 [&_p]:text-map-muted',
  connected:
    'inline-flex items-center gap-2 text-sm font-semibold text-map-route before:size-2 before:rounded-full before:bg-map-route before:content-[""]',
  disconnected:
    'inline-flex items-center gap-2 text-sm font-semibold text-map-danger before:size-2 before:rounded-full before:bg-map-danger before:content-[""]',
  textButton:
    'inline-flex min-h-11 items-center justify-center rounded-md bg-transparent px-3 text-sm font-semibold text-map-route underline-offset-4 hover:bg-map-panel hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active disabled:opacity-50',
  buttonRow: 'flex flex-wrap items-center gap-2',
  primaryButton:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-map-ink px-5 py-2 text-sm font-semibold text-map-paper no-underline transition-colors hover:bg-map-route focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active disabled:pointer-events-none disabled:opacity-50',
  secondaryButton:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-map-line bg-transparent px-4 py-2 text-sm font-semibold text-map-ink no-underline transition-colors hover:bg-map-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active disabled:pointer-events-none disabled:opacity-50',
  dangerButton:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-map-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-danger disabled:pointer-events-none disabled:opacity-50',
  textDangerButton:
    'inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-semibold text-map-danger underline-offset-4 hover:bg-[#f8e9e4] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-danger',
  spinner:
    'size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none',
  confirmationPanel:
    'my-4 grid gap-3 border-l-2 border-map-active bg-map-panel/70 p-4 [&_p]:m-0 [&_p]:text-sm [&_strong]:text-map-ink',
  accountEmail: 'break-all text-sm text-map-muted',
  privacyList: 'mb-1 grid gap-3 pl-5 leading-relaxed marker:text-map-route',
  reconnectNotice:
    'my-2 flex flex-wrap items-center justify-between gap-5 border-y border-map-danger py-6 [&>div]:max-w-[68ch] [&_p]:m-0 [&_a]:shrink-0 [&_a]:no-underline',
  sourceSetupSummary:
    'flex min-h-12 cursor-pointer items-center justify-between gap-4 border-y border-map-line py-3 text-lg font-semibold marker:text-map-route hover:text-map-route focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active',
  sourceSetupContent: 'grid gap-6 border-b border-map-line py-7',
  sourceChoices:
    'grid grid-cols-2 gap-3 border-0 p-0 max-[600px]:grid-cols-1 [&_legend]:mb-3 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-start [&_label]:gap-3 [&_label]:rounded-lg [&_label]:border [&_label]:border-map-line [&_label]:p-4 [&_label]:transition-colors [&_label:hover]:border-map-route',
  sourceChoiceSelected: 'border-map-route bg-map-route-soft/50 ring-1 ring-map-route',
  sourceForm: 'grid gap-4',
  fieldHint: 'block mt-1 text-xs leading-relaxed text-map-muted',
  inputAction: 'flex flex-wrap items-end gap-2 [&_label]:min-w-0 [&_label]:flex-1',
  driveFolderList:
    'grid max-h-64 gap-1 overflow-auto rounded-lg border border-map-line bg-map-surface p-2',
  folderCandidate:
    'flex min-h-11 items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-map-panel focus-visible:outline-2 focus-visible:outline-map-route',
  sourceSaveRow: 'flex justify-end border-t border-map-line pt-4',
  sourceOverviewList: 'grid gap-0 divide-y divide-map-line p-0',
  sourceOverview:
    'grid grid-cols-[minmax(0,1fr)_auto] gap-5 border-b border-map-line py-5 first:border-t max-[680px]:grid-cols-1',
  sourceOverviewMain: 'min-w-0',
  sourceOverviewTitle:
    'flex flex-wrap items-center gap-3 [&_h3]:m-0 [&_h3]:text-lg [&_h3]:font-semibold',
  sourceStatus:
    'inline-flex min-h-7 items-center rounded-full border border-map-line px-2.5 text-xs font-semibold text-map-muted',
  sourceStatus_active: 'border-map-route/40 bg-map-route-soft text-map-ink',
  sourceStatus_disconnected: 'border-map-danger/40 bg-[#f8e9e4] text-map-danger',
  sourceLocation:
    'mt-3 text-sm text-map-muted [&_summary]:min-h-10 [&_summary]:cursor-pointer [&_summary]:font-medium',
  sourceOverviewStats:
    'mt-3 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3 [&_dt]:text-xs [&_dt]:text-map-muted [&_dd]:m-0 [&_dd]:font-semibold [&_dd]:tabular-nums',
  sourceOverviewHint: 'mt-3 text-sm leading-relaxed text-map-muted',
  sourceOverviewRun: 'mt-3 text-xs text-map-muted',
  sourceOverviewActions: 'flex flex-wrap items-start justify-end gap-2 max-[680px]:justify-start',
  reviewQueue: 'grid scroll-mt-24 gap-5 border-y border-map-line py-8',
  reviewQueueRow:
    'flex flex-wrap items-center justify-between gap-4 border-y border-map-line py-4 [&_h3]:m-0 [&_h3]:text-base [&_h3]:font-semibold [&_p]:mb-0 [&_p]:mt-1 [&_p]:text-sm [&_p]:text-map-muted',
  reviewIssues: 'grid gap-3 [&_h3]:m-0 [&_h3]:text-base [&_h3]:font-semibold',
  reviewQueueHint: 'm-0 text-sm text-map-muted',
  reviewQueueError:
    'flex flex-wrap items-center justify-between gap-3 border-y border-map-danger bg-[#f8e9e4] px-4 py-3 text-sm text-map-danger [&_p]:m-0 [&_p]:max-w-[68ch]',
  reviewIssueList:
    'm-0 grid list-none gap-0 divide-y divide-map-line p-0 [&_li]:flex [&_li]:flex-wrap [&_li]:items-center [&_li]:justify-between [&_li]:gap-3 [&_li]:py-3 [&_li>div]:grid [&_li>div]:gap-1 [&_li>div]:max-w-[72ch] [&_li_span]:text-xs [&_li_span]:text-map-muted',
  reviewComplete:
    'grid justify-items-start gap-2 py-4 [&_h3]:m-0 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:m-0 [&_p]:max-w-[60ch] [&_p]:text-sm [&_p]:text-map-muted',
  loadingLine: 'flex min-h-11 items-center gap-3 text-sm text-map-muted',
  emptyState:
    'grid justify-items-center gap-3 border-y border-map-line py-12 text-center [&_p]:m-0 [&_p]:max-w-[55ch] [&_p]:text-map-muted [&_h2]:m-0 [&_h2]:text-xl [&_h2]:font-semibold',
  exclusionList:
    'grid gap-0 divide-y divide-map-line p-0 [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-4 [&_li]:py-3 max-[600px]:[&_li]:items-start max-[600px]:[&_li]:flex-col',
  loadMoreButton:
    'mx-auto mt-4 flex min-h-11 items-center justify-center rounded-md border border-map-line px-5 text-sm font-semibold hover:bg-map-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-active',
  archiveHeader:
    'mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-map-line pb-4 [&_h2]:m-0 [&_h2]:text-2xl [&_h2]:font-semibold',
  syncAction: 'flex flex-wrap items-center justify-end gap-2',
  sourceSelect: 'flex max-w-sm flex-col gap-2 text-sm font-semibold',
  sourceIdentity:
    'flex flex-wrap items-center justify-between gap-3 border-b border-map-line py-4 [&_h3]:m-0 [&_p]:m-0 [&_p]:text-sm [&_p]:text-map-muted',
  syncPanel: 'my-5 border-y border-map-line bg-map-surface/70 px-4 py-4',
  sync_queued: 'border-map-line',
  sync_running: 'border-map-route bg-map-panel/60',
  sync_succeeded: 'border-[#4c8068] bg-map-panel/60',
  sync_partial: 'border-[#97721d] bg-[#fff7df]',
  sync_failed: 'border-map-danger bg-[#f8e9e4]',
  syncPanelHeading:
    'flex flex-wrap items-center justify-between gap-3 [&_h3]:m-0 [&_h3]:text-base [&_h3]:font-semibold [&_p]:m-0 [&_p]:text-xs [&_p]:text-map-muted',
  syncTitleLine: 'flex items-center gap-2',
  progressBlock: 'my-4 grid gap-2 text-sm [&_p]:m-0 [&_p]:text-map-muted',
  indeterminateProgress:
    'h-2 overflow-hidden rounded-full bg-map-panel before:block before:h-full before:w-1/3 before:animate-[progress_1.4s_ease-in-out_infinite] before:bg-map-route before:content-[""]',
  syncCounts:
    'grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3 border-y border-map-line py-3 [&_dt]:text-xs [&_dt]:text-map-muted [&_dd]:m-0 [&_dd]:font-semibold [&_dd]:tabular-nums',
  issues: 'my-3 grid gap-2 pl-5 text-sm marker:text-map-danger [&_li]:leading-relaxed',
  summarySkeleton: 'my-4 grid gap-3',
  summaryBlock: 'my-5 border-y border-map-line py-5',
  summaryHeading:
    'flex flex-wrap items-center justify-between gap-3 [&_h3]:m-0 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:m-0 [&_p]:text-sm [&_p]:text-map-muted',
  completeLabel:
    'inline-flex items-center gap-2 text-sm font-semibold text-map-route before:size-2 before:rounded-full before:bg-map-route before:content-[""]',
  classificationSummary:
    'mt-4 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3 [&_div]:border-l-2 [&_div]:border-map-line [&_div]:pl-3 [&_dt]:text-xs [&_dt]:text-map-muted [&_dd]:m-0 [&_dd]:text-xl [&_dd]:font-semibold [&_dd]:tabular-nums',
  needsReview: 'border-map-active [&_dd]:text-map-danger',
  archiveWorkspace:
    'grid grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.8fr)] gap-6 border-t border-map-line pt-6 max-[900px]:grid-cols-1',
  treePanel:
    'min-w-0 border-r border-map-line pr-5 max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:pb-5 max-[900px]:pr-0',
  treeHeading:
    'mb-3 flex items-center justify-between gap-2 [&_h3]:m-0 [&_h3]:text-base [&_h3]:font-semibold',
  pendingTreeRow: 'flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-map-muted',
  tree: 'grid max-h-[65dvh] gap-1 overflow-auto max-[900px]:max-h-72',
  treeItem:
    'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-map-muted transition-colors hover:bg-map-panel hover:text-map-ink focus-visible:outline-2 focus-visible:outline-map-route',
  currentFolder: 'bg-map-route-soft/60 font-semibold text-map-ink',
  disclosure: 'grid size-8 shrink-0 place-items-center rounded hover:bg-map-panel',
  disclosureSpacer: 'size-8 shrink-0',
  treeRow: 'flex min-w-0 flex-1 items-center gap-2',
  folderIcon: 'size-4 shrink-0 fill-map-route-soft stroke-map-route',
  treeLabel: 'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
  missingLabel: 'shrink-0 text-[0.68rem] text-map-danger',
  folderContents: 'min-w-0',
  contentHeader:
    'mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-map-line pb-4',
  contextLabel: 'text-xs font-semibold uppercase tracking-wider text-map-muted',
  breadcrumb:
    'mb-4 flex flex-wrap items-center gap-2 text-sm text-map-muted [&_a]:text-map-route [&_a]:underline-offset-4 [&_a:hover]:underline',
  folderTitleRow:
    'flex flex-wrap items-center gap-3 [&_h2]:m-0 [&_h2]:text-xl [&_h2]:font-semibold',
  missingNotice:
    'my-3 rounded-md border border-map-danger bg-[#f8e9e4] px-3 py-2 text-sm text-map-danger',
  ruleStatus:
    'my-3 flex flex-wrap items-center justify-between gap-3 border-y border-map-line py-3 text-sm',
  archiveSearch:
    'mb-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-[600px]:grid-cols-1 [&_label]:sr-only',
  galleryToolbar:
    'mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-map-line py-3 [&_label]:flex [&_label]:items-center [&_label]:gap-2 [&_span]:text-sm [&_span]:text-map-muted',
  photoSkeletons: 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3',
  photoGrid:
    'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 max-[600px]:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]',
  selectedPhoto: 'rounded-lg outline outline-2 outline-offset-2 outline-map-active',
  photoSelection:
    'relative block aspect-[4/3] cursor-pointer overflow-hidden rounded-lg bg-map-panel [&_img]:size-full [&_img]:object-cover [&_input]:absolute [&_input]:left-2 [&_input]:top-2 [&_input]:z-10 [&_input]:size-5 [&_input]:accent-map-route',
  visuallyHidden: 'sr-only',
  photoMeta: 'mt-2 grid gap-1 text-xs text-map-muted',
  photoDate: 'font-medium tabular-nums text-map-ink',
  selectionState:
    'absolute bottom-2 right-2 rounded bg-map-ink/85 px-2 py-1 text-[0.68rem] font-semibold text-map-paper',
  photoFolderLink:
    'mt-1 inline-flex min-h-8 items-center text-xs text-map-route underline-offset-4 hover:underline',
  selectionToolbar:
    'sticky bottom-3 z-10 my-4 flex flex-wrap items-center justify-between gap-3 border border-map-line bg-map-paper/95 p-3 backdrop-blur-sm',
  datePanel: 'my-5 border-y border-map-line py-5',
  datePanelHeading:
    'mb-4 flex flex-wrap items-baseline justify-between gap-3 [&_h3]:m-0 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:m-0 [&_p]:text-sm [&_p]:text-map-muted',
  dateFields: 'grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3',
  fieldError: 'mt-2 text-sm font-medium text-map-danger',
  folderDateSection: 'my-5 border-y border-map-line py-5',
  folderDateHeading:
    'mb-4 flex flex-wrap items-start justify-between gap-3 [&_h3]:m-0 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:m-0 [&_p]:text-sm [&_p]:text-map-muted',
  scopeOptions:
    'my-4 grid gap-2 border-0 p-0 [&_legend]:mb-2 [&_label]:flex [&_label]:items-start [&_label]:gap-3 [&_label]:rounded-md [&_label]:border [&_label]:border-map-line [&_label]:p-3 [&_label]:text-sm [&_label]:cursor-pointer',
  scopeSelected: 'border-map-route bg-map-route-soft/50 ring-1 ring-map-route',
  changeReview:
    'my-4 border-l-2 border-map-active bg-map-panel/60 p-4 [&_h3]:m-0 [&_p]:text-sm [&_p]:leading-relaxed',
  history:
    'mt-6 border-t border-map-line py-4 [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:font-semibold [&_summary]:text-map-route',
};
