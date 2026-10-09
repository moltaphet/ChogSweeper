import type { NextRequest } from "next/server";
import { GET as walletInventory } from "../wallet/inventory/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Backwards-compatible alias of /api/wallet/inventory. */
export const GET = (req: NextRequest) => walletInventory(req);
