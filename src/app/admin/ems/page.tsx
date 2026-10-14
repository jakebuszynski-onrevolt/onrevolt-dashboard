import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';
import EmsAdminWorkspace from 'components/onrevolt/EmsAdminWorkspace';
import { getCurrentStaffUser, isAdminUser } from 'lib/onrevolt/staff-server';

export default async function Page() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join('; ');
  const request = new NextRequest('http://localhost/admin/ems', {
    headers: { cookie: cookieHeader },
  });
  const user = await getCurrentStaffUser(request);
  if (!isAdminUser(user)) redirect('/admin/dashboard');

  return <EmsAdminWorkspace />;
}
