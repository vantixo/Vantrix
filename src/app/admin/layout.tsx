import { redirect, notFound } from "next/navigation";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { requireAdmin } from "@/lib/auth/admin";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopBar } from "@/components/admin/admin-top-bar";

/**
 * Every /admin/* route is gated here, once, the same way the route
 * handlers gate themselves (getAuthedUser + requireAdmin — see
 * lib/auth/admin.ts). A non-admin gets a 404 rather than a 403/redirect
 * to avoid confirming the section even exists to someone probing for it;
 * a signed-out visitor gets sent to /login like any other protected page.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getAuthedUser();
  if (!user) redirect("/login");

  try {
    await requireAdmin(user.id);
  } catch {
    notFound();
  }

  return (
    <div className="flex min-h-screen bg-base">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopBar />
        <main className="flex-1 min-w-0 px-4 md:px-8 py-6 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
