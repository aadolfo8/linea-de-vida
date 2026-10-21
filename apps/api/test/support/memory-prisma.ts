/**
 * A small in-memory stand-in for the Prisma client, covering the query shapes the sync, catalog and
 * ordering code use: unique/compound keys, scalar filters, OR/AND/NOT, to-many relation filters
 * (`some`/`none`), ordering, paging, groupBy counts and cascading deletes.
 *
 * It exists so behaviour such as "a re-exported photo attaches to the existing one" is exercised
 * against real data flow instead of call-by-call mocks.
 */
type Row = Record<string, any>;

const uniqueKeys: Record<string, string[][]> = {
  photo: [['userId', 'contentKey']],
  photoFile: [['userId', 'driveFileId']],
  photoExclusion: [['userId', 'driveFileId']],
  manualDateOverride: [['photoId']],
  indexedFolder: [['userId', 'driveFolderId']],
  folderDateRule: [['folderId']],
};

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' &&
  value !== null &&
  !(value instanceof Date) &&
  typeof value !== 'bigint';

const comparable = (value: unknown) => (value instanceof Date ? value.getTime() : value);

const equals = (left: unknown, right: unknown) => comparable(left) === comparable(right);

export class MemoryPrisma {
  readonly tables: Record<string, Row[]> = {};
  private counters: Record<string, number> = {};
  /** Relations resolvable inside `where`/`include`: model -> relation -> (target, local, foreign). */
  private relations: Record<
    string,
    Record<string, { target: string; local: string; foreign: string; many: boolean }>
  > = {
    photo: {
      files: { target: 'photoFile', local: 'id', foreign: 'photoId', many: true },
      override: { target: 'manualDateOverride', local: 'id', foreign: 'photoId', many: false },
      folder: { target: 'indexedFolder', local: 'folderId', foreign: 'id', many: false },
      source: { target: 'photoSource', local: 'sourceId', foreign: 'id', many: false },
    },
    photoFile: {
      photo: { target: 'photo', local: 'photoId', foreign: 'id', many: false },
      source: { target: 'photoSource', local: 'sourceId', foreign: 'id', many: false },
      folder: { target: 'indexedFolder', local: 'folderId', foreign: 'id', many: false },
    },
    indexedFolder: {
      dateRule: { target: 'folderDateRule', local: 'id', foreign: 'folderId', many: false },
    },
  };
  /** Child tables removed together with their parent. */
  private cascades: Record<string, Array<{ table: string; foreign: string }>> = {
    photo: [
      { table: 'photoFile', foreign: 'photoId' },
      { table: 'manualDateOverride', foreign: 'photoId' },
    ],
  };

  readonly photo = this.model('photo');
  readonly photoFile = this.model('photoFile');
  readonly photoExclusion = this.model('photoExclusion');
  readonly manualDateOverride = this.model('manualDateOverride');
  readonly indexedFolder = this.model('indexedFolder');
  readonly folderDateRule = this.model('folderDateRule');
  readonly photoSource = this.model('photoSource');
  readonly syncRun = this.model('syncRun');
  readonly syncIssue = this.model('syncIssue');

  rows(name: string) {
    return (this.tables[name] ??= []);
  }

  async $transaction(operation: any) {
    return Array.isArray(operation) ? Promise.all(operation) : operation(this);
  }

  // ---- filtering -----------------------------------------------------------------------------

  private flattenUnique(model: string, where: Row): Row {
    const flat: Row = {};
    for (const [key, value] of Object.entries(where)) {
      const compound = uniqueKeys[model]?.find(
        (fields) => fields.length > 1 && fields.join('_') === key,
      );
      if (compound && isObject(value)) Object.assign(flat, value);
      else flat[key] = value;
    }
    return flat;
  }

  private matches(model: string, row: Row, rawWhere: Row | undefined): boolean {
    if (!rawWhere) return true;
    const where = this.flattenUnique(model, rawWhere);
    return Object.entries(where).every(([key, condition]) => {
      if (condition === undefined) return true;
      if (key === 'AND')
        return (condition as Row[]).every((entry) => this.matches(model, row, entry));
      if (key === 'OR')
        return (condition as Row[]).some((entry) => this.matches(model, row, entry));
      if (key === 'NOT') {
        const entries = Array.isArray(condition) ? condition : [condition];
        return entries.every((entry) => !this.matches(model, row, entry));
      }
      const relation = this.relations[model]?.[key];
      if (relation) return this.matchesRelation(row, relation, condition as Row | null);
      return this.matchesScalar(row[key], condition);
    });
  }

  private matchesRelation(
    row: Row,
    relation: { target: string; local: string; foreign: string; many: boolean },
    condition: Row | null,
  ) {
    const related = this.rows(relation.target).filter((candidate) =>
      equals(candidate[relation.foreign], row[relation.local]),
    );
    if (!condition) return related.length === 0;
    if ('some' in condition)
      return related.some((candidate) => this.matches(relation.target, candidate, condition.some));
    if ('none' in condition)
      return !related.some((candidate) => this.matches(relation.target, candidate, condition.none));
    if ('is' in condition)
      return condition.is === null
        ? related.length === 0
        : related.some((candidate) => this.matches(relation.target, candidate, condition.is));
    return related.some((candidate) => this.matches(relation.target, candidate, condition));
  }

  private matchesScalar(value: unknown, condition: unknown): boolean {
    if (!isObject(condition)) return equals(value, condition);
    return Object.entries(condition).every(([operator, expected]) => {
      switch (operator) {
        case 'equals':
          return equals(value, expected);
        case 'not':
          if (isObject(expected)) return !this.matchesScalar(value, expected);
          if (expected === null) return value !== null && value !== undefined;
          return value !== null && value !== undefined && !equals(value, expected);
        case 'in':
          return (expected as unknown[]).some((entry) => equals(value, entry));
        case 'notIn':
          return !(expected as unknown[]).some((entry) => equals(value, entry));
        case 'gte':
          return value != null && (comparable(value) as number) >= (comparable(expected) as number);
        case 'gt':
          return value != null && (comparable(value) as number) > (comparable(expected) as number);
        case 'lte':
          return value != null && (comparable(value) as number) <= (comparable(expected) as number);
        case 'lt':
          return value != null && (comparable(value) as number) < (comparable(expected) as number);
        case 'contains':
          return (
            typeof value === 'string' &&
            value.toLowerCase().includes(String(expected).toLowerCase())
          );
        case 'mode':
          return true;
        default:
          throw new Error(`MemoryPrisma: unsupported operator ${operator}`);
      }
    });
  }

  // ---- projection ----------------------------------------------------------------------------

  private shape(model: string, row: Row | undefined, args: Row = {}): Row | null {
    if (!row) return null;
    const result: Row = { ...row };
    const relationsToLoad: Record<string, any> = {
      ...(args.include ?? {}),
      ...Object.fromEntries(
        Object.entries(args.select ?? {}).filter(([, value]) => isObject(value) || value === true),
      ),
    };
    for (const [name, spec] of Object.entries(relationsToLoad)) {
      const relation = this.relations[model]?.[name];
      if (!relation || spec === false) continue;
      let related = this.rows(relation.target).filter((candidate) =>
        equals(candidate[relation.foreign], row[relation.local]),
      );
      const options = isObject(spec) ? spec : {};
      if (options.where)
        related = related.filter((c) => this.matches(relation.target, c, options.where));
      if (options.orderBy) related = this.order(related, options.orderBy);
      const shaped = related.map((entry) =>
        this.shape(relation.target, entry, isObject(spec) ? spec : {}),
      );
      result[name] = relation.many ? shaped : (shaped[0] ?? null);
    }
    return result;
  }

  private order(rows: Row[], orderBy: Row | Row[] | undefined) {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((entry) =>
      Object.entries(entry).map(([field, direction]) => ({
        field,
        direction: isObject(direction) ? (direction.sort as string) : (direction as string),
      })),
    );
    return [...rows].sort((a, b) => {
      for (const { field, direction } of keys) {
        const left = comparable(a[field]) as any;
        const right = comparable(b[field]) as any;
        if (left === right) continue;
        if (left == null) return direction === 'asc' ? 1 : -1;
        if (right == null) return direction === 'asc' ? -1 : 1;
        const result = left < right ? -1 : 1;
        return direction === 'desc' ? -result : result;
      }
      return 0;
    });
  }

  // ---- mutations -----------------------------------------------------------------------------

  private assertUnique(model: string, candidate: Row, ignore?: Row) {
    for (const fields of uniqueKeys[model] ?? []) {
      if (fields.some((field) => candidate[field] === undefined || candidate[field] === null))
        continue;
      const clash = this.rows(model).find(
        (row) => row !== ignore && fields.every((field) => equals(row[field], candidate[field])),
      );
      if (clash) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
  }

  private nextId(model: string) {
    this.counters[model] = (this.counters[model] ?? 0) + 1;
    return `${model}-${this.counters[model]}`;
  }

  private applyData(row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = value;
    }
    return row;
  }

  private remove(model: string, row: Row) {
    const rows = this.rows(model);
    rows.splice(rows.indexOf(row), 1);
    for (const cascade of this.cascades[model] ?? [])
      for (const child of [...this.rows(cascade.table)])
        if (equals(child[cascade.foreign], row.id)) this.remove(cascade.table, child);
  }

  private model(name: string) {
    const find = (where: Row | undefined) =>
      this.rows(name).filter((row) => this.matches(name, row, where));
    return {
      findUnique: async (args: Row) => this.shape(name, find(args.where)[0], args),
      findFirst: async (args: Row = {}) => {
        const sorted = this.order(find(args.where), args.orderBy);
        return this.shape(name, sorted[0], args);
      },
      findMany: async (args: Row = {}) => {
        let rows = this.order(find(args.where), args.orderBy);
        if (args.distinct) {
          const seen = new Set<string>();
          rows = rows.filter((row) => {
            const key = (args.distinct as string[]).map((field) => String(row[field])).join('|');
            return seen.has(key) ? false : (seen.add(key), true);
          });
        }
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((row) => this.shape(name, row, args));
      },
      count: async (args: Row = {}) => find(args.where).length,
      groupBy: async (args: Row) => {
        const groups = new Map<string, Row>();
        for (const row of find(args.where)) {
          const key = (args.by as string[])
            .map((field) => String(comparable(row[field])))
            .join('|');
          const group =
            groups.get(key) ??
            Object.assign(
              Object.fromEntries((args.by as string[]).map((field) => [field, row[field]])),
              { _count: { _all: 0 } },
            );
          group._count._all++;
          groups.set(key, group);
        }
        return [...groups.values()];
      },
      create: async ({ data }: Row) => {
        const row = this.applyData({ id: this.nextId(name), createdAt: new Date(), ...data }, {});
        this.assertUnique(name, row);
        this.rows(name).push(row);
        return { ...row };
      },
      update: async ({ where, data }: Row) => {
        const row = find(where)[0];
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        const next = {
          ...row,
          ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
        };
        this.assertUnique(name, next, row);
        this.applyData(row, data);
        return { ...row };
      },
      createMany: async ({ data }: Row) => {
        for (const entry of data as Row[]) {
          const row = { id: this.nextId(name), createdAt: new Date(), ...entry };
          this.assertUnique(name, row);
          this.rows(name).push(row);
        }
        return { count: (data as Row[]).length };
      },
      updateMany: async ({ where, data }: Row) => {
        const rows = find(where);
        for (const row of rows) this.applyData(row, data);
        return { count: rows.length };
      },
      upsert: async ({ where, create, update }: Row) => {
        const row = find(where)[0];
        if (row) {
          this.applyData(row, update);
          return { ...row };
        }
        const created = { id: this.nextId(name), createdAt: new Date(), ...create };
        this.assertUnique(name, created);
        this.rows(name).push(created);
        return { ...created };
      },
      delete: async ({ where }: Row) => {
        const row = find(where)[0];
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        this.remove(name, row);
        return row;
      },
      deleteMany: async ({ where }: Row = {}) => {
        const rows = find(where);
        for (const row of rows) this.remove(name, row);
        return { count: rows.length };
      },
    };
  }
}
