import { PrismaClient } from '@prisma/client';

/** Real-database tests run only with TEST_DATABASE_URL (CI provides it; migrations applied). */
export const pgUrl = process.env.TEST_DATABASE_URL;

export const pgClient = () =>
  pgUrl
    ? new PrismaClient({ datasources: { db: { url: pgUrl } } })
    : (undefined as unknown as PrismaClient);

/**
 * Two users (`<prefix>-owner`, `<prefix>-other`) with a connection and one source owned by the
 * owner, created from scratch. Deleting the users first cascades away anything a previous test
 * left, so every test starts clean and different specs never touch each other's rows.
 */
export async function resetUsers(prisma: PrismaClient, prefix: string, withSource = true) {
  const owner = `${prefix}-owner`;
  const other = `${prefix}-other`;
  const sourceId = `${prefix}-source`;
  await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
  for (const id of [owner, other])
    await prisma.user.create({ data: { id, email: `${id}@example.test`, displayName: id } });
  const connection = await prisma.oAuthConnection.create({
    data: { userId: owner, provider: 'google', googleAccountId: prefix, grantedScopes: [] },
  });
  if (withSource)
    await prisma.photoSource.create({
      data: {
        id: sourceId,
        userId: owner,
        oauthConnectionId: connection.id,
        driveFolderId: 'root',
        name: 'Archive',
        type: 'GENERIC',
      },
    });
  return { owner, other, sourceId };
}

export const dropUsers = (prisma: PrismaClient, prefix: string) =>
  prisma.user.deleteMany({ where: { id: { in: [`${prefix}-owner`, `${prefix}-other`] } } });

/** A minimal valid photo row. */
export const photoRow = (prefix: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: `${prefix}-owner`,
  contentKey: `md5:${id}`,
  driveFileId: `d-${id}`,
  sourceId: `${prefix}-source`,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  ...extra,
});
