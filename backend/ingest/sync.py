"""Ingestion: list sync, detail sync, round history, outcomes, unseen marking.

Every write goes through `upsert_from_list` / `apply_detail`, which diff old vs new values and
write `eventi`. Runs are idempotent: re-running with the same PVP data changes nothing.
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import (
    Allegato,
    ContattoProfessionale,
    Evento,
    IngestRun,
    Lotto,
    LottoCliente,
    Nota,
    ShareLink,
    Tribunale,
    Vendita,
)
from ingest.mapping import (
    ROME,
    DetailRow,
    ListRow,
    make_lot_key,
    norm_text,
    parse_detail,
    parse_list_item,
)
from ingest.pvp_client import PvpClient, PvpError, SchemaDriftError

log = logging.getLogger("ingest.sync")

ESITO_SOLD = "AGGIU"


def now_utc() -> datetime:
    return datetime.now(UTC)


def today_rome() -> date:
    return datetime.now(ROME).date()


def _start_of_today() -> datetime:
    return datetime.combine(today_rome(), datetime.min.time(), tzinfo=ROME)


def _json(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _point(lat: float | None, lon: float | None) -> str | None:
    if lat is None or lon is None:
        return None
    return f"SRID=4326;POINT({lon} {lat})"


def _short_name(name: str) -> str:
    if name.startswith("Vendite esattoriali"):
        return "Esattoriali"
    n = name.replace("Tribunale di ", "").strip()
    return n.title() if n.isupper() else n


@dataclass
class SyncResult:
    counts: dict[str, int]
    errors: list[str]


class Syncer:
    def __init__(self, db: Session, client: PvpClient, settings: Settings | None = None, run: IngestRun | None = None):
        self.db = db
        self.client = client
        self.settings = settings or get_settings()
        self.run = run
        self.counts: Counter[str] = Counter()
        self.errors: list[str] = []
        self._trib_cache: dict[str, Tribunale] = {}
        # On the very first sync every lot is "new" to us but not to the market: stay silent so
        # the first alert digest is not 17,000 items long.
        self.bootstrap = False

    # ------------------------------------------------------------------ helpers

    def event(
        self,
        lotto: Lotto,
        tipo: str,
        vendita: Vendita | None = None,
        old: dict[str, Any] | None = None,
        new: dict[str, Any] | None = None,
    ) -> None:
        self.db.add(
            Evento(
                lotto_id=lotto.id,
                vendita_id=vendita.id if vendita else None,
                run_id=self.run.id if self.run else None,
                tipo=tipo,
                old={k: _json(v) for k, v in old.items()} if old else None,
                new={k: _json(v) for k, v in new.items()} if new else None,
            )
        )
        self.counts[f"event_{tipo}"] += 1

    def tribunale(self, code: str, name: str | None) -> Tribunale:
        if code in self._trib_cache:
            return self._trib_cache[code]
        t = self.db.scalar(select(Tribunale).where(Tribunale.pvp_code == code))
        if t is None:
            label = name or f"Tribunale {code}"
            t = Tribunale(pvp_code=code, name=label, short_name=_short_name(label), active_for_enrichment=False)
            self.db.add(t)
            self.db.flush()
            self.counts["tribunali_created"] += 1
        self._trib_cache[code] = t
        return t

    def active_tribunali(self) -> list[Tribunale]:
        return list(self.db.scalars(select(Tribunale).where(Tribunale.active_for_enrichment.is_(True))))

    # ------------------------------------------------------------------ tribunali

    def sync_tribunali(self) -> None:
        for t in self.client.tribunali():
            code, name = t.get("codUfficio"), t.get("nomeUfficio") or ""
            if not code or not name.startswith("Tribunale"):
                continue
            existing = self.db.scalar(select(Tribunale).where(Tribunale.pvp_code == code))
            if existing is None:
                self.db.add(Tribunale(pvp_code=code, name=name, short_name=_short_name(name)))
                self.counts["tribunali_created"] += 1
            elif existing.name != name:
                existing.name = name
        self.db.commit()

    # ------------------------------------------------------------------ list sync

    def list_sync(self, scope: str) -> set[int]:
        """Page every upcoming real-estate sale in scope and upsert it. Returns the pvp ids seen."""
        today = today_rome()
        horizon = today.replace(year=today.year + 5)
        if scope == "italy":
            filter_sets = [{"tipoLotto": "IMMOBILI"}]
        else:
            filter_sets = [{"tipoLotto": "IMMOBILI", "tribunale": t.name} for t in self.active_tribunali()]
        seen: set[int] = set()
        for filters in filter_sets:
            for item in self.client.iter_upcoming(filters, today.isoformat()):
                if (item.get("dataVendita") or "9999") > horizon.isoformat():
                    # PVP contains typos like year 3019; they would sort first forever.
                    self.counts["skipped_bad_date"] += 1
                    continue
                row = parse_list_item(item)
                if row.pvp_id in seen:
                    continue
                seen.add(row.pvp_id)
                self.upsert_from_list(row)
                self.counts["list_rows"] += 1
                if len(seen) % 500 == 0:
                    self.db.commit()
                    log.info("list sync: %d rows", len(seen))
        self.db.commit()
        return seen

    def _find_lot_for_new_vendita(self, trib: Tribunale, row: ListRow, anno: int | None) -> Lotto | None:
        key, provisional = make_lot_key(trib.pvp_code, row.rge_numero, anno, row.lotto_codice, row.comune)
        lot = self.db.scalar(select(Lotto).where(Lotto.lot_key == key))
        if lot is not None or not provisional:
            return self._resolve_merged(lot)
        # Year unknown: look for a lot with the same tribunale, RGE number, lot code and comune.
        candidates = list(
            self.db.scalars(
                select(Lotto).where(
                    Lotto.tribunale_id == trib.id,
                    Lotto.rge_numero == row.rge_numero,
                    Lotto.lotto_codice == row.lotto_codice,
                    Lotto.merged_into_id.is_(None),
                )
            )
        )
        comune = norm_text(row.comune)
        same_place = [c for c in candidates if norm_text(c.comune) == comune] if comune else candidates
        if len(same_place) == 1:
            return same_place[0]
        if len(same_place) > 1:
            self.counts["ambiguous_lot_match"] += 1
        return None

    def _resolve_merged(self, lot: Lotto | None) -> Lotto | None:
        while lot is not None and lot.merged_into_id:
            lot = self.db.get(Lotto, lot.merged_into_id)
        return lot

    def upsert_from_list(self, row: ListRow, anno: int | None = None, quiet: bool = False) -> Vendita:
        now = now_utc()
        trib = self.tribunale(row.trib_code, row.trib_name)
        v = self.db.scalar(select(Vendita).where(Vendita.pvp_id == row.pvp_id))

        if v is None:
            lot = self._find_lot_for_new_vendita(trib, row, anno)
            created_lot = lot is None
            if lot is None:
                key, provisional = make_lot_key(trib.pvp_code, row.rge_numero, anno, row.lotto_codice, row.comune)
                lot = Lotto(
                    lot_key=key,
                    key_is_provisional=provisional,
                    tribunale_id=trib.id,
                    rge_numero=row.rge_numero,
                    rge_anno=anno,
                    lotto_codice=row.lotto_codice,
                    first_seen=self._first_seen(row, now),
                    last_seen=now,
                    status="active",
                )
                self.db.add(lot)
                self.db.flush()
                self.counts["lotti_created"] += 1
            prev = self._latest_vendita(lot)
            v = Vendita(pvp_id=row.pvp_id, lotto_id=lot.id)
            self._fill_vendita_from_list(v, row, now)
            self.db.add(v)
            self.db.flush()
            self.counts["vendite_created"] += 1
            is_future = v.data_vendita is not None and v.data_vendita >= _start_of_today()
            if not quiet and is_future and not self.bootstrap:
                if created_lot:
                    self.event(lot, "new_lot", v, new={"prezzo_base": v.prezzo_base, "data_vendita": v.data_vendita})
                else:
                    self.event(
                        lot,
                        "new_round",
                        v,
                        old={"prezzo_base": prev.prezzo_base, "data_vendita": prev.data_vendita} if prev else None,
                        new={"prezzo_base": v.prezzo_base, "data_vendita": v.data_vendita},
                    )
                    if prev and prev.prezzo_base and v.prezzo_base and v.prezzo_base < prev.prezzo_base:
                        self.event(
                            lot,
                            "price_drop",
                            v,
                            old={"prezzo_base": prev.prezzo_base},
                            new={"prezzo_base": v.prezzo_base},
                        )
        else:
            lot = v.lotto
            if v.list_hash != row.list_hash:
                if not quiet:
                    self._diff_vendita(
                        lot,
                        v,
                        prezzo_base=row.prezzo_base,
                        data_vendita=row.data_vendita,
                        esito=row.esito,
                        esito_desc=None,
                    )
                self._fill_vendita_from_list(v, row, now)
                self.counts["vendite_changed"] += 1
            v.last_seen = now
            v.missed_runs = 0

        self._fill_lotto_from_list(lot, row)
        lot.last_seen = now
        lot.missed_runs = 0
        self.refresh_lotto_summary(lot)
        return v

    @staticmethod
    def _first_seen(row: ListRow, now: datetime) -> datetime:
        """When the lot appeared on PVP: its publication date if known, so 'new in the last N days'
        is meaningful from the first sync on."""
        if row.data_pubblicazione:
            published = datetime.combine(row.data_pubblicazione, datetime.min.time(), tzinfo=ROME)
            return min(published, now)
        return now

    def _latest_vendita(self, lot: Lotto) -> Vendita | None:
        return self.db.scalar(
            select(Vendita).where(Vendita.lotto_id == lot.id).order_by(Vendita.data_vendita.desc().nulls_last())
        )

    @staticmethod
    def _fill_vendita_from_list(v: Vendita, row: ListRow, now: datetime) -> None:
        v.data_vendita = row.data_vendita
        v.prezzo_base = row.prezzo_base
        v.offerta_minima = row.offerta_minima
        v.rialzo_minimo = row.rialzo_minimo
        v.data_pubblicazione = row.data_pubblicazione
        if row.esito:
            v.esito = row.esito
        v.raw_list = row.raw
        v.list_hash = row.list_hash
        v.list_fetched_at = now
        v.last_seen = now
        v.missed_runs = 0

    @staticmethod
    def _fill_lotto_from_list(lot: Lotto, row: ListRow) -> None:
        """List data is coarser than detail data: once a lot has details, only fill gaps."""
        overwrite = not lot.has_detail

        def put(attr: str, value: Any) -> None:
            if value is None or value == [] or value == "":
                return
            if overwrite or getattr(lot, attr) in (None, [], ""):
                setattr(lot, attr, value)

        put("tipo_lotto", row.tipo_lotto)
        put("category", row.category)
        put("categorie_bene", row.categorie_bene)
        put("subtype", row.categorie_bene[0] if row.categorie_bene else None)
        put("indirizzo", row.indirizzo)
        put("comune", row.comune)
        put("provincia", row.provincia)
        put("cap", row.cap)
        put("descrizione", row.descrizione)
        put("occupazione", row.occupazione)
        put("cover_image_path", row.cover_image)
        if row.lat is not None and (lot.geom is None or lot.geocode_source in ("comune", None)):
            lot.geom = _point(row.lat, row.lon)
            lot.geocode_source = "pvp"
            lot.geocode_confidence = 0.9

    def _diff_vendita(
        self,
        lot: Lotto,
        v: Vendita,
        *,
        prezzo_base: Decimal | None,
        data_vendita: datetime | None,
        esito: str | None,
        esito_desc: str | None,
        termine_offerte: datetime | None = None,
    ) -> None:
        if prezzo_base is not None and v.prezzo_base is not None and prezzo_base != v.prezzo_base:
            tipo = "price_drop" if prezzo_base < v.prezzo_base else "price_change"
            self.event(lot, tipo, v, old={"prezzo_base": v.prezzo_base}, new={"prezzo_base": prezzo_base})
        if data_vendita and v.data_vendita and data_vendita != v.data_vendita:
            tipo = "postponed" if data_vendita > v.data_vendita else "date_changed"
            self.event(lot, tipo, v, old={"data_vendita": v.data_vendita}, new={"data_vendita": data_vendita})
        if termine_offerte and v.termine_offerte and termine_offerte != v.termine_offerte:
            self.event(
                lot,
                "deadline_changed",
                v,
                old={"termine_offerte": v.termine_offerte},
                new={"termine_offerte": termine_offerte},
            )
        if esito and esito != v.esito:
            self.event(lot, "outcome", v, old={"esito": v.esito}, new={"esito": esito, "esito_desc": esito_desc})

    # ------------------------------------------------------------------ summary

    def refresh_lotto_summary(self, lot: Lotto) -> None:
        self.db.flush()
        vendite = list(
            self.db.scalars(
                select(Vendita).where(Vendita.lotto_id == lot.id).order_by(Vendita.data_vendita.asc().nulls_last())
            )
        )
        if not vendite:
            return
        prev_price: Decimal | None = None
        last_drop: datetime | None = None
        for i, v in enumerate(vendite, start=1):
            v.round_number = i
            if prev_price and v.prezzo_base and v.prezzo_base < prev_price:
                if v.data_pubblicazione:
                    last_drop = datetime.combine(v.data_pubblicazione, datetime.min.time(), tzinfo=ROME)
                else:
                    last_drop = v.created_at or now_utc()
            if v.prezzo_base:
                prev_price = v.prezzo_base
        start = _start_of_today()
        upcoming = [v for v in vendite if v.data_vendita and v.data_vendita >= start]
        current = upcoming[0] if upcoming else vendite[-1]
        lot.current_vendita_id = current.id
        lot.prezzo_base = current.prezzo_base
        lot.offerta_minima = current.offerta_minima
        lot.data_vendita = current.data_vendita
        lot.termine_offerte = current.termine_offerte
        lot.modalita = current.modalita
        lot.valore_stima = next((v.valore_stima for v in reversed(vendite) if v.valore_stima), None)
        lot.prezzo_primo_esperimento = next((v.prezzo_base for v in vendite if v.prezzo_base), None)
        lot.n_rounds = len(vendite)
        lot.last_price_drop_at = last_drop

        if lot.merged_into_id:
            lot.status = "merged"
        elif upcoming:
            lot.status = "unknown" if current.missed_runs >= self.settings.unseen_runs_before_unknown else "active"
        elif any(v.esito == ESITO_SOLD for v in vendite[-1:]):
            lot.status = "sold"
        else:
            lot.status = "unknown"

    # ------------------------------------------------------------------ detail

    def fetch_and_apply_detail(self, v: Vendita) -> None:
        payload = self.client.vendita_detail(v.pvp_id)
        self.apply_detail(v, parse_detail(payload))
        self.counts["details_fetched"] += 1

    def apply_detail(self, v: Vendita, d: DetailRow, quiet: bool = False) -> None:
        now = now_utc()
        lot = v.lotto
        trib = self.tribunale(d.trib_code or lot.tribunale.pvp_code, d.trib_name)
        if d.rge_numero:
            full_key, provisional = make_lot_key(trib.pvp_code, d.rge_numero, d.rge_anno, d.lotto_codice, d.comune)
            if lot.lot_key != full_key:
                lot = self._relink(v, lot, full_key, provisional, trib, d)

        if not quiet and v.fetched_at is not None:
            self._diff_vendita(
                lot,
                v,
                prezzo_base=d.prezzo_base,
                data_vendita=d.data_vendita,
                esito=d.esito,
                esito_desc=d.esito_desc,
                termine_offerte=d.termine_offerte,
            )
        elif not quiet and d.esito and d.esito != v.esito:
            self.event(lot, "outcome", v, old={"esito": v.esito}, new={"esito": d.esito, "esito_desc": d.esito_desc})

        v.pvp_lotto_id = d.pvp_lotto_id
        v.data_vendita = d.data_vendita or v.data_vendita
        v.termine_offerte = d.termine_offerte
        v.prezzo_base = d.prezzo_base if d.prezzo_base is not None else v.prezzo_base
        v.offerta_minima = d.offerta_minima if d.offerta_minima is not None else v.offerta_minima
        v.rialzo_minimo = d.rialzo_minimo if d.rialzo_minimo is not None else v.rialzo_minimo
        v.modalita = d.modalita
        v.tipo_vendita = d.tipo_vendita
        v.valore_stima = d.valore_stima
        v.stato_pvp = d.stato_pvp
        v.esito = d.esito or v.esito
        v.esito_desc = d.esito_desc or v.esito_desc
        v.data_conclusione = d.data_conclusione
        v.data_pubblicazione = d.data_pubblicazione or v.data_pubblicazione
        v.deposito_cauzionale = d.deposito_cauzionale
        v.siti_pubblicita = d.siti
        v.raw = d.raw
        v.content_hash = d.content_hash
        v.detail_list_hash = v.list_hash
        v.fetched_at = now

        # attachments: replace (metadata + PVP path only, never the file itself)
        self.db.execute(delete(Allegato).where(Allegato.vendita_id == v.id))
        for a in d.allegati:
            self.db.add(
                Allegato(
                    vendita_id=v.id,
                    pvp_id=a.pvp_id,
                    tipo=a.tipo,
                    pvp_tipo=a.pvp_tipo,
                    descrizione=a.descrizione,
                    filename=a.filename,
                    path=a.path,
                    size=a.size,
                )
            )
        if self.settings.store_professional_contacts:
            self.db.execute(delete(ContattoProfessionale).where(ContattoProfessionale.vendita_id == v.id))
            for c in d.contacts:
                self.db.add(
                    ContattoProfessionale(vendita_id=v.id, role=c.role, name=c.name, email=c.email, phone=c.phone)
                )

        # lot-level fields: detail is authoritative
        lot.rge_numero = d.rge_numero or lot.rge_numero
        lot.rge_anno = d.rge_anno or lot.rge_anno
        lot.lotto_codice = d.lotto_codice
        lot.tipo_procedura = d.tipo_procedura
        for attr in (
            "tipo_lotto",
            "category",
            "subtype",
            "descrizione",
            "indirizzo",
            "comune",
            "provincia",
            "provincia_sigla",
            "regione",
            "cap",
            "superficie_mq",
            "vani",
            "piano",
            "occupazione",
        ):
            val = getattr(d, attr)
            if val not in (None, ""):
                setattr(lot, attr, val)
        if d.categorie_bene:
            lot.categorie_bene = d.categorie_bene
        if d.dati_catastali:
            lot.dati_catastali = d.dati_catastali
        if d.lat is not None:
            lot.geom = _point(d.lat, d.lon)
            lot.geocode_source = "pvp"
            lot.geocode_confidence = 0.9
        foto = next(
            (
                a.path
                for a in d.allegati
                if a.tipo == "foto" and a.path.split("?")[0].lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
            ),
            None,
        )
        if foto:
            lot.cover_image_path = foto
        lot.has_detail = True
        self.refresh_lotto_summary(lot)

    def _relink(self, v: Vendita, lot: Lotto, full_key: str, provisional: bool, trib: Tribunale, d: DetailRow) -> Lotto:
        """The detail tells us the RGE year: move the vendita to the right lot (see 'Lot identity')."""
        target = self._resolve_merged(self.db.scalar(select(Lotto).where(Lotto.lot_key == full_key)))
        others = self.db.scalar(select(Vendita.id).where(Vendita.lotto_id == lot.id, Vendita.id != v.id).limit(1))
        if target is None and lot.key_is_provisional:
            lot.lot_key = full_key
            lot.key_is_provisional = provisional
            lot.rge_anno = d.rge_anno
            self.counts["lot_keys_confirmed"] += 1
            return lot
        if target is None:
            target = Lotto(
                lot_key=full_key,
                key_is_provisional=provisional,
                tribunale_id=trib.id,
                rge_numero=d.rge_numero,
                rge_anno=d.rge_anno,
                lotto_codice=d.lotto_codice,
                first_seen=lot.first_seen,
                last_seen=now_utc(),
                status="active",
            )
            self.db.add(target)
            self.db.flush()
            self.counts["lotti_split"] += 1
        v.lotto_id = target.id
        v.lotto = target
        self.db.flush()
        if others is None:
            # The old lot is now empty: point it at the target and carry over staff data.
            lot.merged_into_id = target.id
            lot.status = "merged"
            for model in (Nota, LottoCliente, ShareLink):
                self.db.execute(update(model).where(model.lotto_id == lot.id).values(lotto_id=target.id))
            self.db.execute(update(Evento).where(Evento.lotto_id == lot.id).values(lotto_id=target.id))
            self.counts["lotti_merged"] += 1
        else:
            self.refresh_lotto_summary(lot)
        return target

    def detail_sync(self, limit: int | None = None) -> None:
        """Fetch details for new or changed upcoming sales in active tribunali."""
        active_ids = [t.id for t in self.active_tribunali()]
        if not active_ids:
            return
        q = (
            select(Vendita)
            .join(Lotto, Vendita.lotto_id == Lotto.id)
            .where(
                Lotto.tribunale_id.in_(active_ids),
                Vendita.data_vendita >= _start_of_today(),
                or_(Vendita.fetched_at.is_(None), Vendita.detail_list_hash.is_distinct_from(Vendita.list_hash)),
            )
            .order_by(Vendita.data_vendita)
        )
        if limit:
            q = q.limit(limit)
        self._fetch_many(list(self.db.scalars(q)))

    def outcome_sync(self) -> None:
        """Re-read recently concluded sales in active tribunali to capture the outcome (esito)."""
        active_ids = [t.id for t in self.active_tribunali()]
        if not active_ids:
            return
        now = now_utc()
        q = (
            select(Vendita)
            .join(Lotto, Vendita.lotto_id == Lotto.id)
            .where(
                Lotto.tribunale_id.in_(active_ids),
                Vendita.data_vendita < now,
                Vendita.data_vendita > now - timedelta(days=60),
                Vendita.esito.is_(None),
                or_(Vendita.fetched_at.is_(None), Vendita.fetched_at < now - timedelta(days=2)),
            )
            .order_by(Vendita.data_vendita.desc())
            .limit(self.settings.outcome_check_limit)
        )
        self._fetch_many(list(self.db.scalars(q)), counter="outcome_checks")

    def _fetch_many(self, vendite: Iterable[Vendita], counter: str = "detail_candidates") -> None:
        for v in vendite:
            self.counts[counter] += 1
            try:
                self.fetch_and_apply_detail(v)
                self.db.commit()
            except SchemaDriftError:
                self.db.rollback()
                raise
            except PvpError as e:
                self.db.rollback()
                self.errors.append(f"detail {v.pvp_id}: {e}")
                log.warning("detail %s failed: %s", v.pvp_id, e)

    # ------------------------------------------------------------------ round history

    def history_sync(self, max_age_days: int = 30) -> None:
        """For lots in active tribunali, pull every round of the same procedure (past ones included)
        with one search per procedure. Fills the round timeline; emits no events for past rounds."""
        cutoff = now_utc() - timedelta(days=max_age_days)
        lots = list(
            self.db.scalars(
                select(Lotto)
                .join(Tribunale)
                .where(
                    Tribunale.active_for_enrichment.is_(True),
                    Lotto.rge_anno.is_not(None),
                    Lotto.status == "active",
                    or_(Lotto.history_synced_at.is_(None), Lotto.history_synced_at < cutoff),
                )
            )
        )
        procedures: dict[tuple[int, str, int], list[Lotto]] = {}
        for lot in lots:
            assert lot.rge_numero and lot.rge_anno
            procedures.setdefault((lot.tribunale_id, lot.rge_numero, lot.rge_anno), []).append(lot)
        for (trib_id, num, anno), plots in procedures.items():
            trib = self.db.get(Tribunale, trib_id)
            assert trib is not None
            filters = {"tipoLotto": "IMMOBILI", "tribunale": trib.name, "procedura": num, "anno": str(anno)}
            try:
                for item in self.client.iter_all(filters):
                    row = parse_list_item(item)
                    if row.trib_code != trib.pvp_code or row.rge_numero != num:
                        continue
                    # past rounds are history; an upcoming one we had not seen is real news
                    past = row.data_vendita is not None and row.data_vendita < _start_of_today()
                    self.upsert_from_list(row, anno=anno, quiet=past)
                    self.counts["history_rows"] += 1
                now = now_utc()
                for lot in plots:
                    lot.history_synced_at = now
                self.db.commit()
                self.counts["history_procedures"] += 1
            except SchemaDriftError:
                self.db.rollback()
                raise
            except PvpError as e:
                self.db.rollback()
                self.errors.append(f"history {trib.short_name} {num}/{anno}: {e}")

    # ------------------------------------------------------------------ unseen

    def mark_unseen(self, scope: str, seen: set[int]) -> None:
        """Upcoming sales missing from a complete list sync: count misses, flag after N runs."""
        q = (
            select(Vendita)
            .join(Lotto, Vendita.lotto_id == Lotto.id)
            .where(Vendita.data_vendita >= _start_of_today(), Lotto.status.in_(("active", "unknown")))
        )
        if scope != "italy":
            q = q.where(Lotto.tribunale_id.in_([t.id for t in self.active_tribunali()]))
        n = self.settings.unseen_runs_before_unknown
        for v in self.db.scalars(q):
            if v.pvp_id in seen:
                continue
            v.missed_runs += 1
            self.counts["vendite_unseen"] += 1
            if v.missed_runs == n:
                self.event(
                    v.lotto, "cancelled", v, old={"data_vendita": v.data_vendita}, new={"missed_runs": v.missed_runs}
                )
            self.refresh_lotto_summary(v.lotto)
        self.db.commit()

    # ------------------------------------------------------------------ orchestration

    def full_sync(self, scope: str, with_details: bool = True) -> SyncResult:
        self.bootstrap = self.db.scalar(select(Lotto.id).limit(1)) is None
        if self.bootstrap:
            self.counts["bootstrap"] = 1
        self.sync_tribunali()
        seen = self.list_sync(scope)
        if scope == "italy":
            # The national list covers the Veneto courts too, but re-run the per-court query:
            # it is cheap (one page each) and guards against national pagination drift.
            seen |= self.list_sync("veneto")
        # Only reached when every list page was read: a partial list must never flag lots as gone.
        self.mark_unseen(scope, seen)
        if with_details:
            self.detail_sync()
            self.history_sync()
            self.outcome_sync()
        self.counts["pvp_requests"] = self.client.request_count
        return SyncResult(dict(self.counts), self.errors)
