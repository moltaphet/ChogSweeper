import { imageFields } from "./nft-types";
import type { Queryable } from "./queryable";

/** Matches the frontend `NFTItem` shape (tokenId serialised as a decimal string). */
export interface ApiNft {
  contract: string;
  tokenId: string;
  name: string;
  collectionName: string;
  image: string | null;
  imageFallbacks: string[];
  isChog: boolean;
  verified: boolean;
  ecosystem: "chog" | "monad" | null;
  traits: Array<{ trait_type: string; value: string }>;
}

export const MAX_INVENTORY = 500;

/** `collection` is a contract address, the literal "chog", or undefined for everything. */
export async function queryInventory(db: Queryable, owner: string, collection: string | undefined): Promise<ApiNft[]> {
  const params: unknown[] = [owner.toLowerCase(), MAX_INVENTORY];
  let filter = "";
  if (collection === "chog") filter = "AND c.is_chog";
  else if (collection) {
    params.push(collection.toLowerCase());
    filter = `AND t.contract = $${params.length}`;
  }
  // Only tracked collections are listed; Chog first, then by collection and token id.
  const { rows } = await db.query(
    `SELECT t.contract, t.token_id::text AS token_id, t.name, COALESCE(t.image_uri, t.image_url) AS image_uri, t.attributes,
            c.name AS collection_name, c.is_chog, c.verified, c.ecosystem
       FROM nft_tokens t
       JOIN nft_collections c ON c.address = t.contract
      WHERE t.owner = $1 ${filter}
      ORDER BY c.is_chog DESC, c.verified DESC, t.contract, t.token_id
      LIMIT $2`,
    params,
  );
  return rows.map((r: any): ApiNft => ({
    contract: r.contract,
    tokenId: r.token_id,
    name: r.name ?? `${r.collection_name ?? "NFT"} #${r.token_id}`,
    collectionName: r.collection_name ?? "Unknown",
    ...imageFields(r.image_uri, r.contract, r.token_id),
    isChog: !!r.is_chog,
    verified: !!r.verified,
    ecosystem: r.ecosystem ?? null,
    traits: Array.isArray(r.attributes) ? r.attributes : [],
  }));
}
