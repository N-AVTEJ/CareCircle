import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const info = await prisma.$queryRaw`SELECT current_database(), current_user, inet_server_port(), version();`
  console.log('=== DATABASE CONNECTION DETAILS ===')
  console.log(info[0])

  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `
  console.log('=== TABLES IN PUBLIC SCHEMA ===')
  console.log(tables.map(t => t.table_name))

  const userCount = await prisma.user.count()
  const checkInCount = await prisma.checkIn.count()
  const alertCount = await prisma.alert.count()
  console.log('=== RECORD COUNTS ===')
  console.log({ userCount, checkInCount, alertCount })

  const seniors = await prisma.user.findMany({ select: { id: true, name: true, role: true, phone: true, familyGroupId: true } })
  console.log('=== USERS ===')
  console.log(seniors)
}

main()
  .catch(err => {
    console.error('Connection error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
