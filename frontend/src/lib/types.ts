// Mirrors backend/app/schemas.py. Keep in sync when adding fields (see docs/decisions.md).

export interface TribunaleBrief {
  id: number;
  short_name: string;
}

export interface LottoListItem {
  id: number;
  tribunale: TribunaleBrief;
  rge: string | null;
  lotto_codice: string | null;
  category: string | null;
  tipologia: string | null;
  titolo: string;
  indirizzo: string | null;
  comune: string | null;
  provincia: string | null;
  lat: number | null;
  lon: number | null;
  approx: boolean;
  prezzo_base: number | null;
  offerta_minima: number | null;
  data_vendita: string | null;
  termine_offerte: string | null;
  modalita: string | null;
  occupazione: string | null;
  superficie_mq: number | null;
  n_rounds: number;
  ribasso_pct: number | null;
  status: string;
  first_seen: string;
  cover_url: string | null;
  has_detail: boolean;
}

export interface LottiPage {
  items: LottoListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface Allegato {
  id: number;
  tipo: string;
  descrizione: string | null;
  filename: string | null;
  url: string;
  size: number | null;
  image_url?: string | null;
}

export interface Round {
  id: number;
  pvp_id: number;
  round_number: number | null;
  data_vendita: string | null;
  termine_offerte: string | null;
  prezzo_base: number | null;
  offerta_minima: number | null;
  rialzo_minimo: number | null;
  modalita: string | null;
  tipo_vendita: string | null;
  esito: string | null;
  esito_desc: string | null;
  data_pubblicazione: string | null;
  drop_pct: number | null;
  pvp_url: string;
  is_current: boolean;
  has_detail: boolean;
}

export interface Evento {
  id: number;
  tipo: string;
  vendita_id: number | null;
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  at: string;
}

export interface Nota {
  id: number;
  text: string;
  created_at: string;
  user_name: string | null;
  user_id: number | null;
}

export interface ClienteLink {
  id: number;
  cliente_id: number;
  cliente_name: string;
  status: string;
  updated_at: string;
}

export interface Contatto {
  role: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ShareLink {
  id: number;
  token: string;
  url: string;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
}

export interface LottoDetail extends LottoListItem {
  rge_numero: string | null;
  rge_anno: number | null;
  tipo_procedura: string | null;
  tribunale_name: string;
  descrizione: string | null;
  regione: string | null;
  cap: string | null;
  vani: number | null;
  piano: string | null;
  dati_catastali: Record<string, string | number>[] | null;
  valore_stima: number | null;
  sconto_stima_pct: number | null;
  prezzo_mq: number | null;
  rialzo_minimo: number | null;
  tipo_vendita: string | null;
  deposito_cauzionale: string | null;
  prezzo_primo_esperimento: number | null;
  geocode_source: string | null;
  categorie_bene: string[] | null;
  pvp_url: string | null;
  siti_pubblicita: { nome: string; url: string }[];
  rounds: Round[];
  allegati: Allegato[];
  eventi: Evento[];
  note: Nota[];
  clienti: ClienteLink[];
  contatti: Contatto[];
  share_links: ShareLink[];
  detail_fetched_at: string | null;
}

export interface PublicLotto {
  titolo: string;
  tribunale: string;
  rge: string | null;
  lotto_codice: string | null;
  tipologia: string | null;
  category: string | null;
  indirizzo: string | null;
  comune: string | null;
  provincia: string | null;
  lat: number | null;
  lon: number | null;
  approx: boolean;
  descrizione: string | null;
  superficie_mq: number | null;
  vani: number | null;
  piano: string | null;
  occupazione: string | null;
  prezzo_base: number | null;
  offerta_minima: number | null;
  rialzo_minimo: number | null;
  valore_stima: number | null;
  sconto_stima_pct: number | null;
  ribasso_pct: number | null;
  prezzo_primo_esperimento: number | null;
  prezzo_mq: number | null;
  data_vendita: string | null;
  termine_offerte: string | null;
  modalita: string | null;
  deposito_cauzionale: string | null;
  status: string;
  cover_url: string | null;
  rounds: Round[];
  allegati: Allegato[];
  pvp_url: string | null;
  expires_at: string | null;
}

export interface TribunaleMeta {
  id: number;
  name: string;
  short_name: string;
  region: string | null;
  active_for_enrichment: boolean;
  active_lots: number;
}

export interface Meta {
  tribunali: TribunaleMeta[];
  categorie: Record<string, string>;
  tipologie: Record<string, string>;
  modalita: Record<string, string>;
  tipo_vendita: Record<string, string>;
  occupazione: Record<string, string>;
  esiti: Record<string, string>;
  status: Record<string, string>;
  allegati: Record<string, string>;
  eventi: Record<string, string>;
  cliente_status: Record<string, string>;
  store_professional_contacts: boolean;
  last_sync_at: string | null;
  totals: { active: number };
}

export interface User {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
}

export interface SavedSearch {
  id: number;
  name: string;
  criteria: Record<string, unknown>;
  alert_enabled: boolean;
  created_at: string;
  match_count: number | null;
  new_last_7d: number | null;
}

export interface ClienteLotto {
  link_id: number;
  lotto_id: number;
  status: string;
  updated_at: string;
  titolo: string;
  comune: string | null;
  tribunale: string;
  prezzo_base: number | null;
  data_vendita: string | null;
  lotto_status: string;
}

export interface Cliente {
  id: number;
  display_name: string;
  notes: string | null;
  created_at: string;
  lotti: ClienteLotto[];
}

export interface IngestRun {
  id: number;
  kind: string;
  scope: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number> | null;
  errors: string[] | null;
}

export interface AdminStats {
  lotti_by_status: Record<string, number>;
  vendite: number;
  active_with_coords: number;
  active_without_coords: number;
  active_with_detail: number;
  approx_coords: number;
  eventi_7d: Record<string, number>;
  by_tribunale: { id: number; name: string; active: boolean; count: number }[];
}

export type GeoFeature = GeoJSON.Feature<GeoJSON.Point, { id: number; c: string; p: number | null; a: 0 | 1; t: string | null; m: string | null }>;
export type GeoCollection = GeoJSON.FeatureCollection<GeoJSON.Point, GeoFeature["properties"]>;
