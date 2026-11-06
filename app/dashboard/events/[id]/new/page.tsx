"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

function RedirectContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (params?.id) {
      router.replace(`/dashboard/events/${params.id}`);
    } else {
      router.replace("/dashboard");
    }
  }, [params, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
      <p className="text-black">Redirecting to event details...</p>
    </main>
  );
}

export default function RedirectToEvent() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
          <p className="text-black">Loading...</p>
        </main>
      }
    >
      <RedirectContent />
    </Suspense>
  );
}
