import { notFound } from "next/navigation";
import { DevPreview } from "./DevPreview";

/** Visual QA page with sample data. Not available in production builds. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevPreview />;
}
