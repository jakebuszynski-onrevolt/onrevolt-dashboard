import { requireStaffPage } from 'lib/onrevolt/staff-page';

export default async function AdminTemplate({ children }: { children: React.ReactNode }) {
  await requireStaffPage();
  return <>{children}</>;
}
