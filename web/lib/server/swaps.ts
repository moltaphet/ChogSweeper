import { imageFields } from "./nft-types";
import type { Queryable } from "./queryable";

export type SwapListType = "incoming" | "outgoing" | "history" | "public";
export type ApiSwapStatus = "pending" | "expired" | "completed" | "cancelled" | "declined";
export type ApiEcosystem = "chog" | "monad";

export interface ApiSwapAsset {
  contract: string;
  tokenId: string;
  name: string | null;
  image: string | null;
  imageFallbacks: string[];
  collectionName: string | null;
  isChog: boolean;
  /** Collection is in the verified registry. */
  verified: boolean;
  ecosystem: ApiEcosystem | null;
}

export interface ApiSwap {
  id: string;
  maker: string;
  /** null = open to anyone */
  taker: string | null;
  acceptedBy: string | null;
  status: ApiSwapStatus;
  offeredMon: string;
  wantedMon: string;
  offered: ApiSwapAsset[];
  wanted: ApiSwapAsset[];
  expiry: string;
  createdAt: string;
  createdTx: string;
  settledTx: string | null;
  /** Fee the maker paid when creating the trade (wei); kept on acceptance, so null until then. */
  feePaid: string | null;
}

export interface SwapPage {
  swaps: ApiSwap[];
  nextCursor: string | null;
}

/**
 * - public:   open swaps with no designated taker (Open Counter) that can still be accepted
 * - incoming: open swaps addressed to `user` that can still be accepted (not expired)
 * - outgoing: open swaps created by `user`, including expired ones, which the maker must still cancel to reclaim assets
 * - history:  swaps involving `user` that are completed, cancelled or declined
 * Open swaps with no designated taker are not "incoming" for anyone; they belong to a public feed.
 */
const FILTERS: Record<SwapListType, string> = {
  // Open Counter offers anyone may accept. `user` is not used.
  public: "s.taker IS NULL AND s.status = 'PENDING' AND s.expiry > now()",
  // `expiry > now()` guards the gap before the indexer's sweep flips PENDING to EXPIRED.
  incoming: "s.taker = $1 AND s.status = 'PENDING' AND s.expiry > now()",
  outgoing: "s.maker = $1 AND s.status IN ('PENDING', 'EXPIRED')",
  history: "(s.maker = $1 OR s.taker = $1 OR s.accepted_by = $1) AND s.status IN ('ACCEPTED', 'CANCELLED', 'DECLINED')",
};

const assetsSql = (side: "offered" | "wanted") => `
  COALESCE((
    SELECT json_agg(json_build_object(
             'contract', a.contract, 'tokenId', a.token_id::text, 'name', t.name,
             'imageUri', COALESCE(t.image_uri, t.image_url), 'collectionName', c.name, 'isChog', COALESCE(c.is_chog, false),
             'verified', COALESCE(c.verified, false), 'ecosystem', c.ecosystem)
           ORDER BY a.position)
      FROM swap_assets a
      LEFT JOIN nft_tokens t ON t.contract = a.contract AND t.token_id = a.token_id
      LEFT JOIN nft_collections c ON c.address = a.contract
     WHERE a.swap_id = s.id AND a.side = '${side}'), '[]'::json)`;

/** SQL returns the canonical imageUri; turn it into a displayable URL with gateway fallbacks. */
function withImages(rows: Array<Record<string, any>>): ApiSwapAsset[] {
  return rows.map(({ imageUri, ...a }) => ({ ...a, ...imageFields(imageUri ?? null, a.contract, a.tokenId) }) as ApiSwapAsset);
}

/** Maps the stored enum (+ the gap before the expiry sweep) to the label the UI shows. */
export function apiStatus(status: string, isExpired: boolean): ApiSwapStatus {
  return status === "ACCEPTED" ? "completed" : status === "CANCELLED" ? "cancelled" : status === "DECLINED" ? "declined" : isExpired ? "expired" : "pending";
}

export async function listSwaps(
  db: Queryable,
  opts: { user?: string; type: SwapListType; limit: number; cursor?: string | null },
): Promise<SwapPage> {
  const isPublic = opts.type === "public";
  const params: unknown[] = isPublic ? [opts.limit + 1] : [(opts.user ?? "").toLowerCase(), opts.limit + 1];
  const limitIdx = params.length;
  let cursorSql = "";
  if (opts.cursor) {
    params.push(opts.cursor);
    cursorSql = `AND s.id < $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT s.id::text AS id, s.maker, s.taker, s.accepted_by, s.status, s.offered_mon::text AS offered_mon,
            s.wanted_mon::text AS wanted_mon, s.expiry, s.created_at, s.created_tx, s.settled_tx, s.fee_paid::text AS fee_paid,
            (s.status = 'EXPIRED' OR (s.status = 'PENDING' AND s.expiry <= now())) AS is_expired,
            ${assetsSql("offered")} AS offered, ${assetsSql("wanted")} AS wanted
       FROM swaps s
      WHERE ${FILTERS[opts.type]} ${cursorSql}
      ORDER BY s.id DESC
      LIMIT $${limitIdx}`,
    params,
  );

  const page = rows.slice(0, opts.limit).map((r: any): ApiSwap => ({
    id: r.id,
    maker: r.maker,
    taker: r.taker,
    acceptedBy: r.accepted_by,
    status: apiStatus(r.status, r.is_expired),
    offeredMon: r.offered_mon,
    wantedMon: r.wanted_mon,
    offered: withImages(r.offered),
    wanted: withImages(r.wanted),
    expiry: new Date(r.expiry).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    createdTx: r.created_tx,
    settledTx: r.settled_tx,
    feePaid: r.fee_paid,
  }));
  return { swaps: page, nextCursor: rows.length > opts.limit ? page[page.length - 1]!.id : null };
}
