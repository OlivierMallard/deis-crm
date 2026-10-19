CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');
CREATE TABLE "User" ("id" SERIAL PRIMARY KEY, "email" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "role" "UserRole" NOT NULL DEFAULT 'USER', "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "lastLoginAt" TIMESTAMP(3));
CREATE TABLE "Session" ("tokenHash" TEXT PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "csrf" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "AuditLog" ("id" SERIAL PRIMARY KEY, "userId" INTEGER, "action" TEXT NOT NULL, "target" TEXT, "details" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "Prospect" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "archivedAt" TIMESTAMP(3);
