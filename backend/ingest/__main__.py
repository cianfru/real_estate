"""CLI: python -m ingest <command>

sync --scope veneto|italy [--no-details]   list sync (+ details for active tribunali)
detail <pvp_id>                            fetch one sale's details now
geocode [--limit N]                        geocode lots without coordinates
history [--scope italy] [--since DATE]     load the market history (search pages only)
analytics                                  zone values, price index, opportunities
alerts [--run-id N]                        send saved-search digests
nightly [--scope italy] [--no-alerts]      sync + geocode + analytics + alerts (what the cron runs)
tribunali [--activate CODE] [--deactivate CODE]
create-user EMAIL NAME [--admin]           first admin / emergency reset; password prompted (or $LE_PASSWORD)
"""

from __future__ import annotations

import argparse
import getpass
import logging
import os
import sys

from sqlalchemy import select


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="python -m ingest")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync")
    s.add_argument("--scope", choices=["veneto", "italy"], default="veneto")
    s.add_argument("--no-details", action="store_true")
    d = sub.add_parser("detail")
    d.add_argument("pvp_id", type=int)
    g = sub.add_parser("geocode")
    g.add_argument("--limit", type=int)
    h = sub.add_parser("history")
    h.add_argument("--scope", choices=["veneto", "italy"], default="italy")
    h.add_argument("--since", default="2019-01-01")
    sub.add_parser("analytics")
    a = sub.add_parser("alerts")
    a.add_argument("--run-id", type=int)
    n = sub.add_parser("nightly")
    n.add_argument("--scope", choices=["veneto", "italy"], default="italy")
    n.add_argument("--no-alerts", action="store_true")
    t = sub.add_parser("tribunali")
    t.add_argument("--activate")
    t.add_argument("--deactivate")
    u = sub.add_parser("create-user")
    u.add_argument("email")
    u.add_argument("name")
    u.add_argument("--admin", action="store_true")
    args = p.parse_args(argv)

    from ingest import jobs

    if args.cmd == "sync":
        jobs.sync(args.scope, with_details=not args.no_details)
    elif args.cmd == "geocode":
        jobs.geocode(args.limit)
    elif args.cmd == "history":
        from datetime import date

        jobs.history(args.scope, date.fromisoformat(args.since))
    elif args.cmd == "analytics":
        jobs.analytics()
    elif args.cmd == "alerts":
        jobs.alerts(args.run_id)
    elif args.cmd == "nightly":
        jobs.nightly(args.scope, send_alerts=not args.no_alerts)
    elif args.cmd == "detail":
        return _detail(args.pvp_id)
    elif args.cmd == "tribunali":
        return _tribunali(args.activate, args.deactivate)
    elif args.cmd == "create-user":
        return _create_user(args.email, args.name, args.admin)
    return 0


def _detail(pvp_id: int) -> int:
    from app.db import SessionLocal
    from app.models import Vendita
    from ingest.mapping import parse_list_item
    from ingest.pvp_client import PvpClient
    from ingest.sync import Syncer

    db = SessionLocal()
    client = PvpClient()
    syncer = Syncer(db, client)
    v = db.scalar(select(Vendita).where(Vendita.pvp_id == pvp_id))
    if v is None:
        # Not in our list yet: build a minimal list row from the detail, then apply the detail.
        payload = client.vendita_detail(pvp_id)
        lot = payload.get("lotto") or {}
        ind = lot.get("indirizzo") or {}
        proc = payload.get("procedura") or {}
        item = {
            "id": pvp_id,
            "codiceTribunale": proc.get("codUfficio"),
            "tribunale": proc.get("descUfficio"),
            "procedura": proc.get("numeRg"),
            "numeroLotto": lot.get("codLotto"),
            "prezzoBaseAsta": payload.get("impoBaseAsta"),
            "dataOraVendita": None,
            "indirizzo": {
                "via": ind.get("via"),
                "citta": ind.get("descComune"),
                "provincia": ind.get("descProvincia"),
                "cap": ind.get("cap"),
            },
            "tipoLotto": lot.get("codTipoLotto"),
            "categoriaLotto": lot.get("codTipoCategLotto"),
        }
        v = syncer.upsert_from_list(parse_list_item(item), anno=proc.get("numeAnnoRg"))
        db.flush()
        from ingest.mapping import parse_detail

        syncer.apply_detail(v, parse_detail(payload))
    else:
        syncer.fetch_and_apply_detail(v)
    db.commit()
    print(f"vendita {pvp_id} -> lotto {v.lotto_id} ({v.lotto.lot_key})")
    return 0


def _tribunali(activate: str | None, deactivate: str | None) -> int:
    from app.db import SessionLocal
    from app.models import Tribunale

    db = SessionLocal()
    for code, flag in ((activate, True), (deactivate, False)):
        if code:
            t = db.scalar(select(Tribunale).where((Tribunale.pvp_code == code) | (Tribunale.short_name.ilike(code))))
            if t is None:
                print(f"tribunale {code} non trovato", file=sys.stderr)
                return 1
            t.active_for_enrichment = flag
    db.commit()
    for t in db.scalars(select(Tribunale).order_by(Tribunale.active_for_enrichment.desc(), Tribunale.short_name)):
        print(f"{'*' if t.active_for_enrichment else ' '} {t.pvp_code}  {t.name}")
    return 0


def _create_user(email: str, name: str, admin: bool) -> int:
    """The first admin (and an emergency door); everyone else is invited from the Admin page."""
    from app.db import SessionLocal
    from app.models import User
    from app.services.accounts import password_problem, set_password

    pw = os.environ.get("LE_PASSWORD") or getpass.getpass("Password: ")
    db = SessionLocal()
    user = db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        user = User(email=email.lower(), name=name, password_hash="", is_admin=admin)
        db.add(user)
        action = "creato"
    else:
        user.name, user.is_admin, user.is_active = name, admin, True
        action = "aggiornato"
    if problem := password_problem(pw, user):
        print(problem, file=sys.stderr)
        return 1
    set_password(user, pw)
    db.commit()
    print(f"Utente {email} {action}{' (admin)' if admin else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
