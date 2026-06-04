import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get('edg3_admin');
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || !adminCookie || adminCookie.value !== adminPassword) {
    redirect('/admin/login');
  }

  return <>{children}</>;
}
