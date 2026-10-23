import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Maximize2, RefreshCw, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, del, patch, post } from "@/lib/api";
import { date, dateTime, eur, relative } from "@/lib/format";
import { label, useMe, useMeta } from "@/lib/hooks";
import type { Cliente, ClienteLink, Evento, LottoDetail, Meta, Nota, ShareLink } from "@/lib/types";
import { AreaValuation } from "./AreaValuation";
import { Catastali, Description, Documents, Gallery, KeyFigures, MiniMap, PropertyFacts, RoundTimeline } from "./LottoParts";
import { Badge, Button, Card, IconButton, Inline, Select, SectionTitle, Spinner, Textarea, cx } from "./ui";

const STATUS_TONE: Record<string, "ok" | "gold" | "neutral" | "warn" | "bad"> = {
  active: "gold",
  sold: "ok",
  unknown: "neutral",
  withdrawn: "bad",
  merged: "neutral",
};

export function useLotto(id: number | null) {
  return useQuery({ queryKey: ["lotto", id], queryFn: () => api<LottoDetail>(`/lotti/${id}`), enabled: id !== null });
}

function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("px-8 py-7", className)}>
      <SectionTitle action={action}>{title}</SectionTitle>
      {children}
    </section>
  );
}

export function LottoCard({ id, onClose, variant = "drawer" }: { id: number; onClose?: () => void; variant?: "drawer" | "page" }) {
  const { data: d, isLoading, error } = useLotto(id);
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = useMutation({
    mutationFn: () => post<LottoDetail>(`/lotti/${id}/refresh`),
    onSuccess: (data) => {
      qc.setQueryData(["lotto", id], data);
      qc.invalidateQueries({ queryKey: ["lotti"] });
    },
  });

  if (isLoading || !d)
    return (
      <div className="grid h-full min-h-60 place-items-center">
        {error ? <p className="text-sm text-bad">{(error as Error).message}</p> : <Spinner />}
      </div>
    );

  const cur = d.rounds.find((r) => r.is_current);

  return (
    <article className="pb-12">
      <header className="px-8 pt-7">
        <div className="flex items-start justify-between gap-4">
          <Inline className="text-[12px]">
            {[
              <Badge key="s" tone={STATUS_TONE[d.status] ?? "neutral"}>
                {label(meta?.status, d.status)}
              </Badge>,
              cur?.round_number && cur.round_number > 1 ? (
                <Badge key="r">{cur.round_number}° esperimento</Badge>
              ) : null,
              d.opportunity ? (
                <Badge key="o" tone="gold">
                  Opportunità
                </Badge>
              ) : null,
              d.approx ? (
                <Badge key="a" tone="warn">
                  Posizione approssimativa
                </Badge>
              ) : null,
              !d.has_detail ? (
                <Badge key="d" tone="warn">
                  Dettaglio non scaricato
                </Badge>
              ) : null,
            ]}
          </Inline>
          <div className="no-print -mt-1.5 -mr-2 flex shrink-0">
            <IconButton label="Aggiorna da PVP" icon={<RefreshCw className={cx("size-4", refresh.isPending && "animate-spin")} />} onClick={() => refresh.mutate()} />
            {variant === "drawer" && <IconButton label="Apri a pagina intera" icon={<Maximize2 className="size-4" />} onClick={() => navigate(`/lotti/${d.id}`)} />}
            {onClose && <IconButton label="Chiudi" icon={<X className="size-4" />} onClick={onClose} />}
          </div>
        </div>
        <h2 className={cx("mt-3 font-serif leading-[1.1] tracking-tight text-ink", variant === "page" ? "text-[38px]" : "text-[30px]")}>{d.titolo}</h2>
        <p className="mt-2 text-[14.5px] text-muted">
          {[d.indirizzo, d.cap && d.comune && !d.indirizzo?.includes(d.comune) ? `${d.cap} ${d.comune}` : null, d.provincia].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 text-[12.5px] text-faint">
          {d.tribunale_name} · RGE <span className="num">{d.rge ?? "—"}</span> · Lotto {d.lotto_codice ?? "—"}
        </p>
        {refresh.error && <p className="mt-2 text-[12.5px] text-bad">{(refresh.error as Error).message}</p>}
        <div className="no-print mt-4 flex flex-wrap items-center gap-x-6 gap-y-1">
          <ShareButton lot={d} />
          {d.pvp_url && (
            <a href={d.pvp_url} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1 py-1.5 text-[13px] font-medium text-ink">
              <span className="underline decoration-transparent underline-offset-[5px] transition group-hover:decoration-current/40">Scheda sul PVP</span>
              <ArrowUpRight className="size-3.5 text-faint" />
            </a>
          )}
        </div>
      </header>

      {d.allegati.some((a) => a.image_url) && (
        <div className="px-8 pt-6">
          <Gallery docs={d.allegati} />
        </div>
      )}

      <div className="px-8 pt-8">
        <KeyFigures d={d} meta={meta} />
      </div>

      <AreaValuation lot={d} />

      <div className={cx(variant === "page" && "lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-4")}>
        <div>
          <Section title="L'immobile">
            <PropertyFacts d={d} meta={meta} />
            <div className="mt-6">
              <Description text={d.descrizione} />
            </div>
          </Section>

          {d.dati_catastali?.length ? (
            <Section title="Dati catastali">
              <Catastali rows={d.dati_catastali} />
            </Section>
          ) : null}

          <div className="px-8 py-7">
            <RoundTimeline rounds={d.rounds} meta={meta} />
          </div>

          {d.allegati.some((a) => !a.image_url) && (
            <Section title="Documenti">
              <Documents docs={d.allegati} meta={meta} />
              <p className="mt-3 text-[11.5px] text-faint">I documenti si aprono dal portale PVP: non sono copiati sui nostri server.</p>
            </Section>
          )}

          {d.contatti.length > 0 && (
            <Section title="Professionisti">
              <div className="grid gap-6 sm:grid-cols-2">
                {d.contatti.map((c, i) => (
                  <div key={i}>
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{c.role === "SOGGSPV" ? "Referente visite" : c.role.toLowerCase()}</p>
                    <p className="mt-1 text-[14px] text-ink">{c.name}</p>
                    <p className="mt-0.5 flex flex-col text-[13px] text-muted">
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="hover:text-gold">
                          {c.phone}
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="hover:text-gold">
                          {c.email}
                        </a>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {d.siti_pubblicita.length > 0 && (
            <Section title="Pubblicato anche su">
              <p className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                {d.siti_pubblicita.map((s, i) => (
                  <a key={`${s.url}-${i}`} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted transition-colors hover:text-ink">
                    {s.nome.replace(/^www\./, "")}
                    <ArrowUpRight className="size-3 text-faint" />
                  </a>
                ))}
              </p>
            </Section>
          )}
        </div>

        <aside className={cx(variant === "page" && "lg:pt-7")}>
          {variant === "page" && d.lat !== null && d.lon !== null && (
            <div className="px-8 pb-2">
              <MiniMap lat={d.lat} lon={d.lon} category={d.category} approx={d.approx} className="h-64" />
            </div>
          )}
          <Section title="Clienti">
            <ClientLinks lot={d} meta={meta} />
          </Section>
          <Section title="Note interne">
            <Notes lot={d} />
          </Section>
          <Section title="Attività">
            <Events events={d.eventi} meta={meta} />
            <p className="mt-4 text-[11.5px] text-faint">
              Su PVP dal {date(d.first_seen)}
              {d.detail_fetched_at ? ` · dettaglio aggiornato ${relative(d.detail_fetched_at)}` : ""}
            </p>
          </Section>
        </aside>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ notes

function Notes({ lot }: { lot: LottoDetail }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => post<Nota>(`/lotti/${lot.id}/note`, { text }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["lotto", lot.id] });
    },
  });
  const remove = useMutation({
    mutationFn: (nid: number) => del(`/lotti/${lot.id}/note/${nid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lotto", lot.id] }),
  });
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate();
        }}
      >
        <Textarea rows={2} placeholder="Scrivi una nota per lo studio…" value={text} onChange={(e) => setText(e.target.value)} />
        <AnimatePresence>
          {text.trim() && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex justify-end">
              <Button type="submit" size="sm" variant="primary" loading={add.isPending}>
                Salva nota
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
      <ul className="mt-5 space-y-5">
        {lot.note.map((n) => (
          <li key={n.id} className="group">
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">{n.text}</p>
            <div className="mt-1 flex items-center justify-between text-[11.5px] text-faint">
              <span>
                {n.user_name ?? "—"} · {dateTime(n.created_at)}
              </span>
              {(me?.is_admin || me?.id === n.user_id) && (
                <button onClick={() => confirm("Eliminare la nota?") && remove.mutate(n.id)} className="cursor-pointer opacity-0 transition group-hover:opacity-100 hover:text-bad">
                  Elimina
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ clients

function ClientLinks({ lot, meta }: { lot: LottoDetail; meta: Meta | undefined }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const clienti = useQuery({ queryKey: ["clienti"], queryFn: () => api<Cliente[]>("/clienti"), enabled: adding });
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["lotto", lot.id] });
    qc.invalidateQueries({ queryKey: ["clienti"] });
  };
  const link = useMutation({
    mutationFn: (cliente_id: number) => post<ClienteLink>(`/lotti/${lot.id}/clienti`, { cliente_id }),
    onSuccess: () => {
      setAdding(false);
      inv();
    },
  });
  const create = useMutation({
    mutationFn: (name: string) => post<Cliente>("/clienti", { display_name: name }),
    onSuccess: (c) => link.mutate(c.id),
  });
  const setStatus = useMutation({
    mutationFn: ({ lid, status }: { lid: number; status: string }) => patch(`/lotti/${lot.id}/clienti/${lid}`, { status }),
    onSuccess: inv,
  });
  const setPortal = useMutation({
    mutationFn: ({ lid, ...body }: { lid: number; nel_portale?: boolean; nota_cliente?: string }) => patch(`/lotti/${lot.id}/clienti/${lid}`, body),
    onSuccess: inv,
  });
  const unlink = useMutation({ mutationFn: (lid: number) => del(`/lotti/${lot.id}/clienti/${lid}`), onSuccess: inv });

  return (
    <div>
      {lot.clienti.length > 0 && (
        <ul className="divide-y divide-line">
          {lot.clienti.map((c) => (
            <li key={c.id} className="group py-2.5">
              <div className="flex items-center gap-3">
                <Link to={`/clienti?id=${c.cliente_id}`} className="min-w-0 flex-1 truncate text-[14px] text-ink hover:text-gold">
                  {c.cliente_name}
                </Link>
                <Select value={c.status} onChange={(e) => setStatus.mutate({ lid: c.id, status: e.target.value })} className="!h-8 !w-auto !border-transparent !text-[12.5px] text-muted">
                  {Object.entries(meta?.cliente_status ?? {}).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
                <IconButton label="Scollega" className="opacity-0 group-hover:opacity-100" icon={<X className="size-3.5" />} onClick={() => unlink.mutate(c.id)} />
              </div>
              <ClientPortalControls link={c} onChange={(body) => setPortal.mutate({ lid: c.id, ...body })} />
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="mt-2 flex items-center gap-4">
          <Select
            autoFocus
            defaultValue=""
            onChange={(e) => {
              if (e.target.value === "__new") {
                const name = prompt("Nome del cliente (solo nome interno, nessun dato fiscale)");
                if (name?.trim()) create.mutate(name.trim());
              } else if (e.target.value) link.mutate(Number(e.target.value));
            }}
          >
            <option value="">Scegli un cliente…</option>
            {clienti.data
              ?.filter((c) => !lot.clienti.some((l) => l.cliente_id === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            <option value="__new">Nuovo cliente…</option>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Annulla
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="gold" className="mt-1" onClick={() => setAdding(true)}>
          Collega un cliente
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ events

const EVENT_TONE: Record<string, string> = {
  new_lot: "text-gold",
  new_round: "text-gold",
  price_drop: "text-ok",
  postponed: "text-warn",
  cancelled: "text-bad",
  deadline_changed: "text-warn",
};

function eventDetail(e: Evento): string | null {
  const o = e.old ?? {};
  const n = e.new ?? {};
  if ("prezzo_base" in n && "prezzo_base" in o) return `${eur(o.prezzo_base as number)} → ${eur(n.prezzo_base as number)}`;
  if ("prezzo_base" in n) return eur(n.prezzo_base as number);
  if ("data_vendita" in n && "data_vendita" in o) return `${date(o.data_vendita as string)} → ${date(n.data_vendita as string)}`;
  if ("termine_offerte" in n) return `${dateTime(o.termine_offerte as string)} → ${dateTime(n.termine_offerte as string)}`;
  if ("esito" in n) return (n.esito_desc as string) || (n.esito as string);
  return null;
}

function Events({ events, meta }: { events: Evento[]; meta: Meta | undefined }) {
  if (!events.length) return <p className="text-[13px] text-faint">Nessuna variazione registrata.</p>;
  return (
    <ul className="space-y-3">
      {events.slice(0, 12).map((e) => (
        <li key={e.id} className="text-[13px]">
          <span className={cx("font-medium", EVENT_TONE[e.tipo] ?? "text-ink")}>{label(meta?.eventi, e.tipo)}</span>
          <span className="num ml-2 text-muted">{eventDetail(e)}</span>
          <span className="block text-[11px] text-faint">{dateTime(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ share

function ShareButton({ lot }: { lot: LottoDetail }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const create = useMutation({
    mutationFn: () => post<ShareLink>(`/lotti/${lot.id}/share`),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["lotto", lot.id] });
      copy(s);
    },
  });
  const revoke = useMutation({
    mutationFn: (sid: number) => post(`/lotti/${lot.id}/share/${sid}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lotto", lot.id] }),
  });
  const copy = (s: ShareLink) => {
    navigator.clipboard?.writeText(s.url).catch(() => {});
    setCopied(s.id);
    setTimeout(() => setCopied(null), 1600);
  };
  const live = lot.share_links.filter((s) => !s.revoked && (!s.expires_at || new Date(s.expires_at) > new Date()));

  return (
    <div className="relative">
      <Button size="sm" variant="gold" onClick={() => setOpen(!open)}>
        Condividi con il cliente
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 z-30 mt-2 w-[340px] max-w-[calc(100vw-48px)]"
          >
            <Card className="p-6 shadow-float">
              <p className="font-serif text-[18px] text-ink">Link di sola lettura</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                Il cliente vede la scheda senza note, clienti o contatti. Il link scade dopo 30 giorni.
              </p>
              {live.length > 0 && (
                <ul className="mt-4 divide-y divide-line">
                  {live.map((s) => (
                    <li key={s.id} className="flex items-center gap-4 py-2 text-[12.5px]">
                      <span className="min-w-0 flex-1 text-muted">Scade il {date(s.expires_at)}</span>
                      <button className="cursor-pointer font-medium text-ink hover:text-gold" onClick={() => copy(s)}>
                        {copied === s.id ? "Copiato" : "Copia"}
                      </button>
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                        Apri
                      </a>
                      <button className="cursor-pointer text-muted hover:text-bad" onClick={() => revoke.mutate(s.id)}>
                        Revoca
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button className="mt-3" size="sm" variant="primary" loading={create.isPending} onClick={() => create.mutate()} iconRight={<ArrowUpRight className="size-3.5" />}>
                {copied && !live.some((s) => s.id === copied) ? "Copiato negli appunti" : "Crea e copia un nuovo link"}
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** What this client sees of the property in their area: visible or not, and the firm's message. */
function ClientPortalControls({ link, onChange }: { link: ClienteLink; onChange: (body: { nel_portale?: boolean; nota_cliente?: string }) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(link.nota_cliente ?? "");
  return (
    <div className="mt-1 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <button type="button" className="inline-flex cursor-pointer items-center gap-2 text-muted hover:text-ink" onClick={() => onChange({ nel_portale: !link.nel_portale })}>
          <span className={cx("size-2 rounded-full", link.nel_portale ? "bg-gold" : "bg-line-strong")} />
          {link.nel_portale ? "Visibile nella sua area" : "Nascosto al cliente"}
        </button>
        {!editing && (
          <button
            type="button"
            className="cursor-pointer text-muted hover:text-ink"
            onClick={() => {
              setText(link.nota_cliente ?? "");
              setEditing(true);
            }}
          >
            {link.nota_cliente ? "Modifica la nota per il cliente" : "Scrivi una nota per il cliente"}
          </button>
        )}
        {!link.portal_access && <span className="text-faint">non ha ancora un accesso all'area riservata</span>}
      </div>
      {editing ? (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ nota_cliente: text });
            setEditing(false);
          }}
        >
          <Textarea autoFocus rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Es. «Visita fissata giovedì alle 10. Consigliamo un'offerta entro 120.000 €.»" />
          <div className="mt-2 flex gap-5">
            <Button type="submit" size="sm" variant="gold">
              Salva
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Annulla
            </Button>
          </div>
        </form>
      ) : (
        link.nota_cliente && <p className="mt-1.5 border-l-2 border-gold/60 pl-3 font-serif text-[13.5px] leading-relaxed whitespace-pre-line text-ink/80">{link.nota_cliente}</p>
      )}
    </div>
  );
}
