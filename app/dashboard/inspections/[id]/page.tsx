import { redirect, notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import InspectionDetailClient from "./InspectionDetailClient";

type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"];

type InspectionWithRelations = InspectionRow & {
  jobs: { id: string; job_number: string } | null;
  users: { name: string } | null;
};

interface InspectionDetailPageProps {
  params: Promise<{ id: string }>;
}

async function InspectionDetailPage({ params }: InspectionDetailPageProps) {
  const { id } = await params;

  const userData = await getUser();

  if (!userData?.session) {
    redirect("/login");
  }

  if (!userData.user) {
    redirect("/auth/new-user");
  }

  const { tenant_id } = userData;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("inspections")
    .select(
      `*,
       jobs!job_id(id, job_number),
       users!inspector_id(name)`
    )
    .eq("id", id)
    .eq("tenant_id", tenant_id as string)
    .single();

  if (error || !data) {
    notFound();
  }

  const insp = data as unknown as InspectionWithRelations;

  return <InspectionDetailClient initialInspection={insp} tenantId={tenant_id as string} />;
}

export default InspectionDetailPage;
