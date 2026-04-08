import { getUser } from "@/lib/supabase/get-user";
import { redirect } from "next/navigation";
import { Sidebar } from "./sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export async function AppLayout({ children }: AppLayoutProps) {
  const userData = await getUser();

  // No session - redirect to login
  if (!userData?.session) {
    redirect("/login");
  }

  // Session exists but no user row in public.users - redirect to new-user setup
  if (!userData.user) {
    redirect("/auth/new-user");
  }

  const { user } = userData;

  return (
    <div className="flex min-h-screen bg-[#f5f0e8]">
      {/* Sidebar */}
      <Sidebar user={{ name: user.name, role: user.role }} />

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto">
        <div className="min-h-screen">
          {children}
        </div>
      </main>
    </div>
  );
}
