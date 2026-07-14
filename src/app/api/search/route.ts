import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const q = (req.nextUrl.searchParams.get('q') || '').trim();
    if (q.length < 2) return jsonResponse({ ok: true, data: [] });
    const [clients, projects, offers, products] = await Promise.all([
      prisma.client.findMany({
        where: { OR: [
          { displayName: { contains: q } },
          { taxId: { contains: q } },
          { contacts: { some: { OR: [{ email: { contains: q } }, { phone: { contains: q } }] } } },
        ] },
        select: { id: true, displayName: true, clientType: true },
        take: 8,
      }),
      prisma.project.findMany({
        where: { title: { contains: q } },
        select: { id: true, clientId: true, title: true, client: { select: { displayName: true } } },
        take: 8,
      }),
      prisma.offer.findMany({
        where: { OR: [{ number: { contains: q } }, { title: { contains: q } }] },
        select: { id: true, number: true, title: true, project: { select: { client: { select: { displayName: true } } } } },
        take: 8,
      }),
      prisma.product.findMany({
        where: { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { producer: { contains: q } }] },
        select: { id: true, name: true, sku: true, producer: true },
        take: 8,
      }),
    ]);
    return jsonResponse({
      ok: true,
      data: [
        ...clients.map((item) => ({ type: 'client', id: item.id, title: item.displayName, subtitle: item.clientType, href: `/admin/clients/${item.id}` })),
        ...projects.map((item) => ({ type: 'project', id: item.id, title: item.title, subtitle: item.client.displayName, href: `/admin/clients/${item.clientId}?projectId=${item.id}` })),
        ...offers.map((item) => ({ type: 'offer', id: item.id, title: item.number, subtitle: `${item.project.client.displayName} · ${item.title}`, href: `/admin/offers/${item.id}/print` })),
        ...products.map((item) => ({ type: 'product', id: item.id, title: item.name, subtitle: [item.producer, item.sku].filter(Boolean).join(' · '), href: `/admin/catalog?productId=${item.id}` })),
      ].slice(0, 24),
    });
  } catch (error) {
    return serverError('Nie udało się wyszukać', error);
  }
}
