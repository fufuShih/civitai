
-- AlterTable
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS     "nsfwLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS     "nsfwLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BountyEntry" ADD COLUMN IF NOT EXISTS     "nsfwLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN IF NOT EXISTS     "nsfwLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Image" ADD COLUMN IF NOT EXISTS     "nsfwLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ModelVersion" ADD COLUMN IF NOT EXISTS     "nsfwLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS     "nsfwLevel" INTEGER NOT NULL DEFAULT 0;

