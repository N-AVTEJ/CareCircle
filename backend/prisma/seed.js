import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting CareCircle database seed...')

  // Clean existing records in reverse dependency order
  await prisma.alert.deleteMany()
  await prisma.checkIn.deleteMany()
  await prisma.user.deleteMany()

  const sharedFamilyGroupId = 'fam_group_carecircle_101'

  // 1. Senior user
  const senior = await prisma.user.create({
    data: {
      name: 'Eleanor Vance',
      role: 'SENIOR',
      phone: '+1-555-0143',
      familyGroupId: sharedFamilyGroupId,
    },
  })

  // 2. Family user
  const familyMember = await prisma.user.create({
    data: {
      name: 'David Vance',
      role: 'FAMILY',
      phone: '+1-555-0198',
      familyGroupId: sharedFamilyGroupId,
    },
  })

  // Sample CheckIn for the senior
  const checkIn = await prisma.checkIn.create({
    data: {
      userId: senior.id,
      type: 'PILLS',
      status: 'Morning blood pressure pills taken',
      timestamp: new Date(),
    },
  })

  // Sample Alert for the senior
  const alert = await prisma.alert.create({
    data: {
      userId: senior.id,
      type: 'NO_CHECKIN',
      status: 'ACTIVE',
      timestamp: new Date(),
    },
  })

  console.log('✅ Seed completed successfully:')
  console.log({
    sharedFamilyGroupId,
    senior: { id: senior.id, name: senior.name, role: senior.role, phone: senior.phone },
    familyMember: { id: familyMember.id, name: familyMember.name, role: familyMember.role, phone: familyMember.phone },
    sampleCheckIn: { id: checkIn.id, type: checkIn.type, status: checkIn.status },
    sampleAlert: { id: alert.id, type: alert.type, status: alert.status },
  })
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
