import { dbRead, dbWrite } from '~/server/db/client';
import {
  GetClubTiersInput,
  GetInfiniteClubSchema,
  GetPaginatedClubResourcesSchema,
  RemoveClubResourceInput,
  SupportedClubEntities,
  UpdateClubResourceInput,
  UpsertClubInput,
  UpsertClubResourceInput,
  UpsertClubTierInput,
} from '~/server/schema/club.schema';
import { Availability, ClubAdminPermission, Prisma } from '@prisma/client';
import { throwAuthorizationError, throwBadRequestError } from '~/server/utils/errorHandling';
import { createEntityImages } from '~/server/services/image.service';
import { ImageMetaProps } from '~/server/schema/image.schema';
import { isDefined } from '~/utils/type-guards';
import { GetByIdInput } from '~/server/schema/base.schema';
import { imageSelect } from '~/server/selectors/image.selector';
import {
  entityAvailabilityUpdate,
  entityOwnership,
  entityRequiresClub,
} from '~/server/services/common.service';
import { getPagingData } from '~/server/utils/pagination-helpers';
import { createBuzzTransaction, getUserBuzzAccount } from '~/server/services/buzz.service';
import { TransactionType } from '~/server/schema/buzz.schema';

export const userContributingClubs = async ({
  userId,
  clubIds,
  tx,
}: {
  userId: number;
  clubIds?: number[];
  tx?: Prisma.TransactionClient;
}) => {
  const dbClient = tx ?? dbRead;
  const clubs = await dbClient.club.findMany({
    select: {
      id: true,
      name: true,
      userId: true,
      admins: {
        where: {
          userId,
        },
        select: {
          clubId: true,
          permissions: true,
        },
      },
    },
    where: {
      id: clubIds ? { in: clubIds } : undefined,
      OR: [
        {
          userId,
        },
        {
          admins: {
            some: { userId },
          },
        },
      ],
    },
  });

  return clubs.map((club) => ({
    ...club,
    admin: club.admins[0],
  }));
};

export const getClub = async ({
  id,
  tx,
}: GetByIdInput & {
  userId?: number;
  isModerator?: boolean;
  tx?: Prisma.TransactionClient;
}) => {
  const dbClient = tx ?? dbRead;
  const club = await dbClient.club.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      avatar: { select: imageSelect },
      coverImage: { select: imageSelect },
      headerImage: { select: imageSelect },
      nsfw: true,
      billing: true,
      unlisted: true,
      userId: true,
    },
  });

  return {
    ...club,
    avatar: club.avatar
      ? {
          ...club.avatar,
          meta: club.avatar.meta as ImageMetaProps,
          metadata: club.avatar.metadata as MixedObject,
        }
      : club.avatar,
    coverImage: club.coverImage
      ? {
          ...club.coverImage,
          meta: club.coverImage.meta as ImageMetaProps,
          metadata: club.coverImage.metadata as MixedObject,
        }
      : club.coverImage,
    headerImage: club.headerImage
      ? {
          ...club.headerImage,
          meta: club.headerImage.meta as ImageMetaProps,
          metadata: club.headerImage.metadata as MixedObject,
        }
      : club.headerImage,
  };
};

export async function upsertClub({
  isModerator,
  userId,
  id,
  ...input
}: UpsertClubInput & {
  userId: number;
  isModerator: boolean;
}) {
  if (id) {
    // Check for permission:
    const [club] = await userContributingClubs({ userId });

    if (!club && !isModerator) {
      throw throwAuthorizationError('You do not have permission to edit this club');
    }

    const isOwner = club.userId === userId;
    const canManageClub =
      club.admin && club.admin.permissions.includes(ClubAdminPermission.ManageClub);

    if (!isOwner && !canManageClub && !isModerator) {
      throw throwAuthorizationError('You do not have permission to edit this club');
    }

    return updateClub({ ...input, id, userId });
  } else {
    return createClub({ ...input, userId });
  }
}

export const updateClub = async ({
  coverImage,
  headerImage,
  avatar,
  id,
  userId,
  ...data
}: Omit<UpsertClubInput, 'tiers' | 'deleteTierIds'> & {
  id: number;
  userId: number;
}) => {
  const club = await dbWrite.$transaction(
    async (tx) => {
      await tx.club.findUniqueOrThrow({ where: { id } });
      const createdImages = await createEntityImages({
        tx,
        images: [coverImage, headerImage, avatar].filter((i) => !i?.id).filter(isDefined),
        userId,
      });

      const club = await tx.club.update({
        where: { id },
        data: {
          ...data,
          avatarId:
            avatar === null
              ? null
              : avatar !== undefined
              ? avatar?.id ?? createdImages.find((i) => i.url === avatar.url)?.id
              : undefined,
          coverImageId:
            coverImage === null
              ? null
              : coverImage !== undefined
              ? coverImage?.id ?? createdImages.find((i) => i.url === coverImage.url)?.id
              : undefined,
          headerImageId:
            headerImage === null
              ? null
              : headerImage !== undefined
              ? headerImage?.id ?? createdImages.find((i) => i.url === headerImage.url)?.id
              : undefined,
        },
      });

      return club;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return club;
};

export const createClub = async ({
  coverImage,
  headerImage,
  avatar,
  tiers = [],
  deleteTierIds = [],
  userId,
  ...data
}: Omit<UpsertClubInput, 'id'> & {
  userId: number;
}) => {
  const club = await dbWrite.$transaction(
    async (tx) => {
      const createdImages = await createEntityImages({
        tx,
        images: [coverImage, headerImage, avatar].filter((i) => !i?.id).filter(isDefined),
        userId,
      });

      const club = await tx.club.create({
        data: {
          ...data,
          userId,
          avatarId:
            avatar === null
              ? null
              : avatar !== undefined
              ? avatar?.id ?? createdImages.find((i) => i.url === avatar.url)?.id
              : undefined,
          coverImageId:
            coverImage === null
              ? null
              : coverImage !== undefined
              ? coverImage?.id ?? createdImages.find((i) => i.url === coverImage.url)?.id
              : undefined,
          headerImageId:
            headerImage === null
              ? null
              : headerImage !== undefined
              ? headerImage?.id ?? createdImages.find((i) => i.url === headerImage.url)?.id
              : undefined,
        },
      });

      // Create tiers:
      await upsertClubTiers({
        clubId: club.id,
        tiers,
        deleteTierIds,
        userId,
        tx,
      });

      return club;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return club;
};

export const upsertClubTiers = async ({
  clubId,
  tiers,
  deleteTierIds,
  tx,
  userId,
  isModerator,
}: {
  userId: number;
  isModerator?: boolean;
  clubId: number;
  tiers?: UpsertClubTierInput[];
  deleteTierIds?: number[];
  tx?: Prisma.TransactionClient;
}) => {
  const dbClient = tx ?? dbWrite;

  const [userClub] = await userContributingClubs({ userId, clubIds: [clubId], tx: dbClient });

  if (
    userId !== userClub?.userId &&
    !isModerator &&
    !userClub?.admin?.permissions?.includes(ClubAdminPermission.ManageTiers)
  ) {
    throw throwBadRequestError('Only club owners can edit club tiers');
  }

  if ((deleteTierIds?.length ?? 0) > 0) {
    const deletingTierWithMembers = await dbClient.clubTier.findFirst({
      where: {
        id: {
          in: deleteTierIds,
        },
        memberships: {
          some: {},
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (deletingTierWithMembers) {
      throw throwBadRequestError(
        'Cannot delete tier with members. Please move the members out of this tier before deleting it.'
      );
    }

    await dbClient.clubTier.deleteMany({
      where: {
        id: {
          in: deleteTierIds,
        },
      },
    });
  }

  if (tiers && tiers.length > 0) {
    const createdImages = await createEntityImages({
      userId,
      images: tiers
        .filter((tier) => tier.coverImage?.id === undefined)
        .map((tier) => tier.coverImage)
        .filter(isDefined),
      tx: dbClient,
    });

    const toCreate = tiers.filter((tier) => !tier.id);
    if (toCreate.length > 0) {
      await dbClient.clubTier.createMany({
        data: toCreate.map(({ coverImage, ...tier }) => ({
          ...tier,
          clubId,
          coverImageId: coverImage?.id ?? createdImages.find((i) => i.url === coverImage?.url)?.id,
        })),
        skipDuplicates: true,
      });
    }

    const toUpdate = tiers.filter((tier) => tier.id !== undefined);
    if (toUpdate.length > 0) {
      await Promise.all(
        toUpdate.map((tier) => {
          const { id, coverImage, clubId, ...data } = tier;
          return dbClient.clubTier.update({
            where: {
              id: id as number,
            },
            data: {
              ...data,
              coverImageId:
                coverImage === null
                  ? null
                  : coverImage === undefined
                  ? undefined
                  : coverImage?.id ?? createdImages.find((i) => i.url === coverImage?.url)?.id,
            },
          });
        })
      );
    }
  }
};

export const getClubTiers = async ({
  clubId,
  clubIds,
  listedOnly,
  joinableOnly,
  userId,
  isModerator,
  tierId,
}: GetClubTiersInput & {
  userId?: number;
  isModerator?: boolean;
}) => {
  if (!clubId && !clubIds?.length) {
    return [];
  }

  const userClubs = userId ? await userContributingClubs({ userId }) : [];
  const userClubIds = userClubs.map((c) => c?.id);

  // Only if the user can actually view all tiers, we can ignore the listedOnly and joinableOnly flags:
  const canViewAllTiers =
    isModerator ||
    (userClubIds.includes(clubId ?? -1) && !(clubIds ?? []).some((c) => !userClubIds.includes(c)));

  if (!canViewAllTiers) {
    listedOnly = true;
    joinableOnly = true;
  }

  const tiers = await dbRead.clubTier.findMany({
    where: {
      clubId: clubId ? clubId : clubIds ? { in: clubIds } : undefined,
      unlisted: listedOnly !== undefined ? !listedOnly : undefined,
      joinable: joinableOnly !== undefined ? joinableOnly : undefined,
      id: tierId || undefined,
    },
    select: {
      id: true,
      name: true,
      description: true,
      coverImage: {
        select: imageSelect,
      },
      unitAmount: true,
      currency: true,
      clubId: true,
      joinable: true,
      unlisted: true,
      memberLimit: true,
      _count: {
        select: {
          memberships: true,
        },
      },
    },
    orderBy: {
      unitAmount: 'asc',
    },
  });

  return tiers.map((t) => ({
    ...t,
    coverImage: t.coverImage
      ? {
          ...t.coverImage,
          meta: t.coverImage.meta as ImageMetaProps,
          metadata: t.coverImage.metadata as MixedObject,
        }
      : t.coverImage,
  }));
};

export const upsertClubResource = async ({
  userId,
  isModerator,
  entityType,
  entityId,
  clubs,
}: UpsertClubResourceInput & {
  userId: number;
  isModerator?: boolean;
}) => {
  // First, check that the person is
  const [ownership] = await entityOwnership({ userId, entities: [{ entityType, entityId }] });

  if (!isModerator && !ownership.isOwner) {
    throw throwAuthorizationError('You do not have permission to add this resource to a club');
  }

  const clubIds = clubs.map((c) => c.clubId);
  const contributingClubs = await userContributingClubs({ userId, clubIds });

  if (!isModerator && clubIds.some((c) => !contributingClubs.find((cc) => cc.id === c))) {
    throw throwAuthorizationError(
      'You do not have permission to add this resource to one of the provided clubs'
    );
  }

  const clubTiers = clubIds.length
    ? await dbRead.clubTier.findMany({
        where: {
          clubId: {
            in: clubIds,
          },
        },
      })
    : [];

  const clubTierIds = clubTiers.map((t) => t.id);

  if (clubIds.length === 0) {
    // this resource will be made public:
    const [details] = await getClubDetailsForResource({
      entities: [
        {
          entityId,
          entityType,
        },
      ],
    });

    await dbWrite.entityAccess.deleteMany({
      where: {
        accessToId: entityId,
        accessToType: entityType,
        OR: [
          {
            accessorId: {
              in: details.clubs.map((c) => c.clubId),
            },
            accessorType: 'Club',
          },
          {
            accessorId: {
              in: details.clubs
                .map((c) => c.clubTierIds)
                .filter(isDefined)
                .flat(),
            },
            accessorType: 'ClubTier',
          },
        ],
      },
    });

    // Check that no other access exists:
    const access = await dbWrite.entityAccess.findFirst({
      where: {
        accessToId: entityId,
        accessToType: entityType,
      },
    });

    if (access) {
      // Some access type - i.e, user access, is still there.
      return;
    }

    await entityAvailabilityUpdate({
      entityType,
      entityIds: [entityId],
      availability: Availability.Public,
    });

    return;
  }

  // Now, add and/or remove it from clubs:
  await dbWrite.$transaction(async (tx) => {
    // Prisma doesn't do update or create with contraints... Need to delete all records and then add again
    await tx.entityAccess.deleteMany({
      where: {
        accessToId: entityId,
        accessToType: entityType,
        OR: [
          {
            accessorId: {
              in: clubIds,
            },
            accessorType: 'Club',
          },
          {
            accessorId: {
              in: clubTierIds,
            },
            accessorType: 'ClubTier',
          },
        ],
      },
    });

    const generalClubAccess = clubs.filter((c) => !c.clubTierIds || !c.clubTierIds.length);
    const tierClubAccess = clubs.filter((c) => c.clubTierIds && c.clubTierIds.length);
    const clubAccessIds = generalClubAccess.map((c) => c.clubId);
    const tierAccessIds = tierClubAccess
      .map((c) => c.clubTierIds)
      .filter(isDefined)
      .flat();

    // Add general club access:
    await tx.entityAccess.createMany({
      data: clubAccessIds.map((clubId) => ({
        accessToId: entityId,
        accessToType: entityType,
        accessorId: clubId,
        accessorType: 'Club',
        addedById: userId,
      })),
    });

    // Add tier club access:
    await tx.entityAccess.createMany({
      data: tierAccessIds.map((clubTierId) => ({
        accessToId: entityId,
        accessToType: entityType,
        accessorId: clubTierId,
        accessorType: 'ClubTier',
        addedById: userId,
      })),
    });

    await entityAvailabilityUpdate({
      entityType,
      entityIds: [entityId],
      availability: Availability.Private,
    });
  });
};

export const getClubDetailsForResource = async ({
  entities,
}: {
  entities: {
    entityType: SupportedClubEntities;
    entityId: number;
  }[];
}) => {
  const clubRequirements = await entityRequiresClub({ entities });
  return clubRequirements;
};

export const getAllClubs = <TSelect extends Prisma.ClubSelect>({
  input: { cursor, limit: take, sort, engagement, userId, nsfw, clubIds },
  select,
}: {
  input: GetInfiniteClubSchema;
  select: TSelect;
}) => {
  const AND: Prisma.Enumerable<Prisma.ClubWhereInput> = [];

  if (clubIds) {
    AND.push({
      id: {
        in: clubIds,
      },
    });
  }

  if (userId) {
    if (engagement) {
      if (engagement === 'engaged')
        AND.push({
          OR: [
            { userId },
            {
              memberships: {
                some: {
                  userId,
                },
              },
            },
          ],
        });
    } else {
      // Your created clubs or public clubs:
      AND.push({
        OR: [
          {
            userId,
          },
          {
            unlisted: false,
          },
        ],
      });
    }
  }

  if (!userId) {
    AND.push({ OR: [{ unlisted: false }] });
  }

  const orderBy: Prisma.ClubFindManyArgs['orderBy'] = [];
  orderBy.push({ id: 'desc' });

  return dbRead.club.findMany({
    take,
    cursor: cursor ? { id: cursor } : undefined,
    select,
    where: {
      nsfw,
      AND,
    },
    orderBy,
  });
};

type ModelVersionClubResource = {
  entityType: 'ModelVersion';
  data: {
    id: number;
    name: string;
    modelVersion: {
      id: number;
      name: string;
    };
  };
};

type Article = {
  entityType: 'Article';
  data: {
    id: number;
    title: string;
  };
};

type PaginatedClubResource = {
  entityId: number;
  entityType: string;
  clubId: number;
  clubTierIds: number[];
} & (ModelVersionClubResource | Article);

export const getPaginatedClubResources = async ({
  clubId,
  clubTierId,
  page,
  limit,
}: GetPaginatedClubResourcesSchema) => {
  const AND: Prisma.Sql[] = [Prisma.raw(`(ct."id" IS NOT NULL OR c.id IS NOT NULL)`)];

  if (clubTierId) {
    // Use exists here rather than a custom join or smt so that we can still capture other tiers this item is available on.
    AND.push(
      Prisma.raw(
        `EXISTS (SELECT 1 FROM "EntityAccess" eat WHERE eat."accessorType" = 'ClubTier' AND eat."accessorId" = ${clubTierId})`
      )
    );
  }

  const fromQuery = Prisma.sql`
  FROM "EntityAccess" ea 
    LEFT JOIN "ClubTier" ct ON ea."accessorType" = 'ClubTier' AND ea."accessorId" = ct."id" AND ct."clubId" = ${clubId}  
    LEFT JOIN "Club" c ON ea."accessorType" = 'Club' AND ea."accessorId" = c.id AND c."id" = ${clubId}
    LEFT JOIN "ModelVersion" mv ON mv."id" = ea."accessToId" AND ea."accessToType" = 'ModelVersion'
    LEFT JOIN "Model" m ON m."id" = mv."modelId"
    LEFT JOIN "Article" a ON a."id" = ea."accessToId" AND ea."accessToType" = 'Article'
    
    WHERE ${Prisma.join(AND, ' AND ')}
  `;

  const [row] = await dbRead.$queryRaw<{ count: number }[]>`
    SELECT COUNT(DISTINCT CONCAT(ea."accessToId", ea."accessToType"))::INT as "count"
    ${fromQuery}
  `;

  const items = await dbRead.$queryRaw<PaginatedClubResource[]>`
    SELECT 
      ea."accessToId" as "entityId", 
      ea."accessToType" as "entityType",
      ${clubId}::INT as "clubId",
      COALESCE(
        json_agg(ct."id") FILTER (WHERE ct."id" IS NOT NULL),
        '[]'
      ) as "clubTierIds",
      CASE 
        WHEN ea."accessToType" = 'ModelVersion' THEN jsonb_build_object(
          'id', m."id",
          'name', m."name",
          'modelVersion', jsonb_build_object(
            'id', mv."id",
            'name', mv."name"
          )
        ) 
        WHEN ea."accessToType" = 'Article' THEN jsonb_build_object(
          'id', a."id",
          'title', a."title"
        )
        ELSE '{}'::jsonb
      END
      as "data"
    
    ${fromQuery}
    GROUP BY "entityId", "entityType", m."id", mv."id", a."id"
    ORDER BY ea."accessToId" DESC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}
  `;

  return getPagingData({ items, count: (row?.count as number) ?? 0 }, limit, page);
};

export const updateClubResource = async ({
  userId,
  isModerator,
  entityType,
  entityId,
  clubId,
  clubTierIds,
}: UpdateClubResourceInput & {
  userId: number;
  isModerator?: boolean;
}) => {
  // First, check that the person is
  const [ownership] = await entityOwnership({ userId, entities: [{ entityType, entityId }] });

  if (!isModerator && !ownership.isOwner) {
    throw throwAuthorizationError('You do not have permission to add this resource to a club');
  }

  const contributingClubs = await userContributingClubs({ userId, clubIds: [clubId] });

  if (!isModerator && !contributingClubs.find((cc) => cc.id === clubId)) {
    throw throwAuthorizationError(
      'You do not have permission to add this resource to one of the provided clubs'
    );
  }

  const clubTiers = await dbRead.clubTier.findMany({
    where: {
      clubId,
    },
  });

  const allClubTierIds = clubTiers.map((t) => t.id);

  // Now, add and/or remove it from clubs:
  await dbWrite.$transaction(async (tx) => {
    // Prisma doesn't do update or create with contraints... Need to delete all records and then add again
    await tx.entityAccess.deleteMany({
      where: {
        accessToId: entityId,
        accessToType: entityType,
        OR: [
          {
            accessorId: clubId,
            accessorType: 'Club',
          },
          {
            accessorId: {
              in: allClubTierIds,
            },
            accessorType: 'ClubTier',
          },
        ],
      },
    });

    const isGeneralClubAccess = (clubTierIds ?? []).length === 0;
    // Add general club access:
    if (isGeneralClubAccess) {
      await tx.entityAccess.create({
        data: {
          accessToId: entityId,
          accessToType: entityType,
          accessorId: clubId,
          accessorType: 'Club',
          addedById: userId,
        },
      });
    } else {
      // Add tier club access:
      await tx.entityAccess.createMany({
        data: (clubTierIds ?? []).map((clubTierId) => ({
          accessToId: entityId,
          accessToType: entityType,
          accessorId: clubTierId,
          accessorType: 'ClubTier',
          addedById: userId,
        })),
      });
    }
  });
};

export const removeClubResource = async ({
  userId,
  isModerator,
  entityType,
  entityId,
  clubId,
}: RemoveClubResourceInput & {
  userId: number;
  isModerator?: boolean;
}) => {
  const [userClub] = await userContributingClubs({ userId, clubIds: [clubId] });
  const [ownership] = await entityOwnership({ userId, entities: [{ entityType, entityId }] });
  const canRemoveResource =
    isModerator ||
    ownership.isOwner ||
    userClub?.userId === userId ||
    userClub.admin?.permissions.includes(ClubAdminPermission.ManageResources);

  if (!canRemoveResource) {
    throw throwAuthorizationError(
      'You do not have permission to remove this resource from this club'
    );
  }

  const clubTiers = await dbRead.clubTier.findMany({
    where: {
      clubId,
    },
  });

  const clubTierIds = clubTiers.map((t) => t.id);

  // Now, add and/or remove it from clubs:
  await dbWrite.$transaction(async (tx) => {
    // Prisma doesn't do update or create with contraints... Need to delete all records and then add again
    await tx.entityAccess.deleteMany({
      where: {
        accessToId: entityId,
        accessToType: entityType,
        OR: [
          {
            accessorId: clubId,
            accessorType: 'Club',
          },
          {
            accessorId: {
              in: clubTierIds,
            },
            accessorType: 'ClubTier',
          },
        ],
      },
    });

    // Check if it still requires club access:
    const access = await tx.entityAccess.findFirst({
      where: {
        accessToId: entityId,
        accessToType: entityType,
      },
    });

    if (access) {
      // Some access type - i.e, user access, is still there.
      return;
    }

    // Make this resource public:
    await entityAvailabilityUpdate({
      entityType,
      entityIds: [entityId],
      availability: Availability.Public,
    });
  });
};

export const deleteClub = async ({
  id,
  userId,
  isModerator,
}: GetByIdInput & { userId: number; isModerator: boolean }) => {
  const club = await getClub({ id, userId, isModerator: true });
  if (!club) {
    throw throwBadRequestError('Club does not exist');
  }

  if (club.userId !== userId && !isModerator) {
    throw throwBadRequestError('Only club owners can delete clubs');
  }

  const buzzAccount = await getUserBuzzAccount({ accountId: club.id, accountType: 'Club' });

  if ((buzzAccount?.balance ?? 0) > 0) {
    await createBuzzTransaction({
      toAccountId: club.userId,
      fromAccountId: club.id,
      fromAccountType: 'Club',
      type: TransactionType.Tip,
      amount: buzzAccount.balance as number,
    });
  }

  return dbWrite.club.delete({
    where: {
      id,
    },
  });
};