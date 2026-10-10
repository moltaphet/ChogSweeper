import { redirect } from "next/navigation";

/** The app moved to /launchpad; old links (`/swap?tab=requests`) keep working. `tab=new` was the default view, so it stays "new". */
export default function SwapRedirect({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") q.set(k, v);
  if (!q.has("tab")) q.set("tab", "new");
  redirect(`/launchpad?${q.toString()}`);
}
