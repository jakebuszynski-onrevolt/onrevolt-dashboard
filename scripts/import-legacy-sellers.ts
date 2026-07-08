import { PrismaClient } from '@prisma/client';
import { generateTemporaryPassword, hashPassword } from '../src/lib/onrevolt/staff';

const prisma = new PrismaClient();

const legacySellers = [
  {
    legacyId: 3,
    firstName: 'Daniel',
    lastName: 'Majtczak',
    username: 'Daniel Majtczak',
    email: 'daniel@majtczak.com',
    active: true,
    registeredAt: '2025-09-12T00:27:33.000Z',
  },
  {
    legacyId: 4,
    firstName: 'Patryk',
    lastName: 'Piksa',
    username: 'patrykp',
    email: 'patryk.piksa@onrevolt.com',
    active: true,
    registeredAt: '2025-12-02T10:51:10.000Z',
  },
  {
    legacyId: 5,
    firstName: 'Szymon',
    lastName: 'Adamczyk',
    username: 'szymona',
    email: 'szymon.adamczyk@onrevolt.com',
    active: true,
    registeredAt: '2025-12-02T10:54:57.000Z',
  },
  {
    legacyId: 6,
    firstName: 'Jacek',
    lastName: 'Buszyński',
    username: 'jacekb',
    email: 'jacek.buszynski@onrevolt.com',
    active: true,
    registeredAt: '2025-12-02T10:56:39.000Z',
  },
  {
    legacyId: 7,
    firstName: 'Mariusz',
    lastName: 'Śmietana',
    username: 'mariuszs',
    email: 'mariusz.smietana@onrevolt.com',
    active: true,
    registeredAt: '2025-12-02T10:59:03.000Z',
  },
  {
    legacyId: 8,
    firstName: 'Hanna',
    lastName: 'Kossakowska',
    username: 'HannaKossakowska',
    email: 'hanna.kossakowska@onrevolt.com',
    active: true,
    registeredAt: '2026-01-30T15:06:40.000Z',
  },
  {
    legacyId: 9,
    firstName: 'Michał',
    lastName: 'Pakuła',
    username: 'Michał Pakuła',
    email: 'michal.pakula@onrevolt.com',
    active: true,
    registeredAt: '2026-03-12T14:28:40.000Z',
  },
];

function displayName(seller: (typeof legacySellers)[number]) {
  const fullName = `${seller.firstName} ${seller.lastName}`.trim();
  return fullName || seller.username || seller.email;
}

async function main() {
  const sellerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SPRZEDAWCA' } });
  const sellerCompanyRole = await prisma.companyRole.findUniqueOrThrow({ where: { code: 'SPRZEDAWCA' } });
  const summary = { created: 0, updated: 0, queuedEmails: 0 };

  for (const seller of legacySellers) {
    const email = seller.email.toLowerCase();
    const existing = await prisma.staffUser.findUnique({ where: { email } });

    if (existing) {
      await prisma.staffUser.update({
        where: { id: existing.id },
        data: {
          name: displayName(seller),
          active: seller.active,
          systemRole: 'USER',
          positionTitle: 'Sprzedawca',
          roleId: sellerRole.id,
        },
      });

      await prisma.staffUserCompanyRole.upsert({
        where: {
          staffUserId_companyRoleId: {
            staffUserId: existing.id,
            companyRoleId: sellerCompanyRole.id,
          },
        },
        update: {},
        create: {
          staffUserId: existing.id,
          companyRoleId: sellerCompanyRole.id,
        },
      });
      summary.updated += 1;
      continue;
    }

    const temporaryPassword = generateTemporaryPassword();
    const user = await prisma.staffUser.create({
      data: {
        email,
        name: displayName(seller),
        phone: '',
        active: seller.active,
        systemRole: 'USER',
        positionTitle: 'Sprzedawca',
        roleId: sellerRole.id,
        passwordHash: hashPassword(temporaryPassword),
        passwordResetRequired: true,
        avatarUrl: null,
        createdAt: new Date(seller.registeredAt),
      },
    });

    await prisma.staffUserCompanyRole.create({
      data: {
        staffUserId: user.id,
        companyRoleId: sellerCompanyRole.id,
      },
    });

    await prisma.emailMessage.create({
      data: {
        to: user.email,
        subject: 'Dostęp do panelu onRevolt',
        body: `Utworzono konto w panelu onRevolt.\nLogin: ${user.email}\nHasło tymczasowe: ${temporaryPassword}\nPo zalogowaniu zmień hasło.`,
        status: 'QUEUED',
      },
    });

    summary.created += 1;
    summary.queuedEmails += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
