import { apiStatus, type ApiSwapStatus } from "./swaps";
import { imageFields } from "./nft-types";
import type { Queryable } from "./queryable";

export interface ActivityItem {
  id: string;
  status: ApiSwapStatus;
  /** When the latest thing happened to this trade (settlement if settled, otherwise creation). */
  at: string;
  maker: string;
  taker: string | null;
  assetCount: number;
  /** Total MON on both sides of the trade, in wei. */
  monWei: string;
  first: { name: string | null; image: string | null; imageFallbacks: string[]; collectionName: string | null; verified: boolean; tokenId: string; contract: string } | null;
}

export interface SiteStats {
  totals: {
    trades: number;
    completed: number;
    open: number;
    /** Distinct wallets that created, were offered, or accepted a trade. */
    traders: number;
    last24h: number;
    /** MON that actually changed hands in completed trades (both sides), in wei. */
    volumeWei: string;
    verifiedCollections: number;
  };
  recent: ActivityItem[];
  generatedAt: string;
}

export async function getSiteStats(db: Queryable, recentLimit = 8): Promise<SiteStats> {
  const totals = (
    await db.query<any>(
      `SELECT
         (SELECT count(*) FROM swaps)::int                                                       AS trades,
         (SELECT count(*) FROM swaps WHERE status = 'ACCEPTED')::int                             AS completed,
         (SELECT count(*) FROM swaps WHERE status = 'PENDING' AND expiry > now())::int           AS open,
         (SELECT count(*) FROM participants)::int                                                AS traders,
         (SELECT count(*) FROM swaps WHERE created_at > now() - interval '24 hours')::int        AS last24h,
         (SELECT COALESCE(sum(offered_mon + wanted_mon), 0) FROM swaps WHERE status = 'ACCEPTED')::text AS volume_wei,
         (SELECT count(*) FROM nft_collections WHERE verified)::int                              AS verified_collections`,
    )
  ).rows[0];

  const { rows } = await db.query<any>(
    `SELECT s.id::text AS id, s.maker, s.taker, s.status, s.created_at, s.settled_at,
            (s.status = 'EXPIRED' OR (s.status = 'PENDING' AND s.expiry <= now())) AS is_expired,
            (s.offered_mon + s.wanted_mon)::text AS mon_wei,
            (SELECT count(*) FROM swap_assets a WHERE a.swap_id = s.id)::int AS asset_count,
            f.contract AS f_contract, f.token_id::text AS f_token_id, t.name AS f_name,
            COALESCE(t.image_uri, t.image_url) AS f_image_uri, c.name AS f_collection, COALESCE(c.verified, false) AS f_verified
       FROM swaps s
       LEFT JOIN LATERAL (SELECT contract, token_id FROM swap_assets a WHERE a.swap_id = s.id ORDER BY side, position LIMIT 1) f ON true
       LEFT JOIN nft_tokens t ON t.contract = f.contract AND t.token_id = f.token_id
       LEFT JOIN nft_collections c ON c.address = f.contract
      ORDER BY GREATEST(s.created_at, COALESCE(s.settled_at, s.created_at)) DESC, s.id DESC
      LIMIT $1`,
    [recentLimit],
  );

  return {
    totals: {
      trades: totals.trades, completed: totals.completed, open: totals.open, traders: totals.traders, last24h: totals.last24h,
      volumeWei: totals.volume_wei, verifiedCollections: totals.verified_collections,
    },
    recent: rows.map((r: any): ActivityItem => ({
      id: r.id,
      status: apiStatus(r.status, r.is_expired),
      at: new Date(r.settled_at ?? r.created_at).toISOString(),
      maker: r.maker,
      taker: r.taker,
      assetCount: r.asset_count,
      monWei: r.mon_wei,
      first: r.f_contract
        ? { name: r.f_name, collectionName: r.f_collection, verified: !!r.f_verified, tokenId: r.f_token_id, contract: r.f_contract, ...imageFields(r.f_image_uri, r.f_contract, r.f_token_id) }
        : null,
    })),
    generatedAt: new Date().toISOString(),
  };
}
