import AdminLayoutClient from 'components/onrevolt/AdminLayoutClient';
import { requireStaffPage } from 'lib/onrevolt/staff-page';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaffPage();
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}