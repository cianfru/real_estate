import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Bell,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Mail,
  Maximize2,
  Phone,
  RefreshCw,
  Share2,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, del, patch, post } from "@/lib/api";
import { date, dateTime, eur, relative } from "@/lib/format";
import { label, useMe, useMeta } from "@/lib/hooks";
import type { Cliente, ClienteLink, Evento, LottoDetail, Meta, Nota, ShareLink } from "@/lib/types";
import { Catastali, Description, Documents, Gallery, KeyFigures, MiniMap, PropertyFacts, RoundTimeline } from "./LottoParts";
import { Thumb } from "./LottoRow";
import { Badge, Button, Card, IconButton, Select, SectionTitle, Spinner, Textarea, cx } from "./ui";

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
    <section className={cx("px-6 py-5", className)}>
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

  return (
    <article className="pb-10">
      {/* header */}
      <header className={cx("relative", variant === "drawer" ? "px-6 pt-5" : "px-6 pt-6")}>
        <div className="flex items-start gap-4">
          <Thumb url={d.cover_url} category={d.category} className="hidden size-20 shrink-0 sm:block" />
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{label(meta?.status, d.status)}</Badge>
              {(() => {
                const cur = d.rounds.find((r) => r.is_current);
                return cur?.round_number && cur.round_number > 1 ? <Badge>{cur.round_number}° esperimento</Badge> : null;
              })()}
              {d.approx && <Badge tone="warn">Posizione approssimativa</Badge>}
              {!d.has_detail && <Badge tone="warn">Dettaglio non ancora scaricato</Badge>}
            </div>
            <h2 className="font-serif text-[26px] leading-[1.15] tracking-tight text-ink">{d.titolo}</h2>
            <p className="mt-1 text-[14px] text-muted">
              {[d.indirizzo, d.cap && d.comune && !d.indirizzo?.includes(d.comune) ? `${d.cap} ${d.comune}` : null, d.provincia]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-1.5 text-[12.5px] text-faint">
              {d.tribunale_name} · RGE <span className="num text-muted">{d.rge ?? "—"}</span> · Lotto{" "}
              <span className="text-muted">{d.lotto_codice ?? "—"}</span>
            </p>
          </div>
          <div className="no-print -mr-2 -mt-1 flex shrink-0 gap-0.5">
            <IconButton
              label="Aggiorna da PVP"
              icon={<RefreshCw className={cx("size-4", refresh.isPending && "animate-spin")} />}
              onClick={() => refresh.mutate()}
            />
            {variant === "drawer" && (
              <IconButton label="Apri a pagina intera" icon={<Maximize2 className="size-4" />} onClick={() => navigate(`/lotti/${d.id}`)} />
            )}
            {onClose && <IconButton label="Chiudi" icon={<X className="size-4" />} onClick={onClose} />}
          </div>
        </div>
        {refresh.error && <p className="mt-2 text-[12.5px] text-bad">{(refresh.error as Error).message}</p>}
        <div className="no-print mt-4 flex flex-wrap gap-2">
          {d.pvp_url && (
            <a href={d.pvp_url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" icon={<ExternalLink className="size-3.5" />}>
                Scheda PVP
              </Button>
            </a>
          )}
          <ShareButton lot={d} />
        </div>
      </header>

      <div className="px-6 pt-5">
        <KeyFigures d={d} meta={meta} />
      </div>
      {d.allegati.some((a) => a.image_url) && (
        <div className="px-6 pt-5">
          <Gallery docs={d.allegati} />
        </div>
      )}

      <div className={cx(variant === "page" && "lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-2")}>
        <div>
          <Section title="Dettagli">
            <PropertyFacts d={d} meta={meta} />
            <div className="mt-4">
              <Description text={d.descrizione} />
            </div>
          </Section>

          {d.dati_catastali?.length ? (
            <Section title="Dati catastali">
              <Catastali rows={d.dati_catastali} />
            </Section>
          ) : null}

          <div className="px-6 py-5">
            <RoundTimeline rounds={d.rounds} meta={meta} />
          </div>

          {d.allegati.some((a) => !a.image_url) && (
            <Section title="Documenti">
              <Documents docs={d.allegati} meta={meta} />
              <p className="mt-2 text-[11.5px] text-faint">I documenti si aprono dal portale PVP, non sono copiati sui nostri server.</p>
            </Section>
          )}

          {d.contatti.length > 0 && (
            <Section title="Professionisti">
              <div className="grid gap-2 sm:grid-cols-2">
                {d.contatti.map((c, i) => (
                  <div key={i} className="rounded-xl bg-surface-2/70 px-3 py-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                      {c.role === "SOGGSPV" ? "Referente visite" : c.role.toLowerCase()}
                    </p>
                    <p className="text-[13.5px] text-ink">{c.name}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-[12.5px] text-muted">
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-gold">
                          <Phone className="size-3" /> {c.phone}
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-gold">
                          <Mail className="size-3" /> {c.email}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {d.siti_pubblicita.length > 0 && (
            <Section title="Pubblicato anche su">
              <div className="flex flex-wrap gap-1.5">
                {d.siti_pubblicita.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-[12px] text-muted hover:text-ink"
                  >
                    {s.nome.replace(/^www\./, "")} <ArrowUpRight className="size-3" />
                  </a>
                ))}
              </div>
            </Section>
          )}
        </div>

        <aside className={cx(variant === "page" && "lg:pt-5")}>
          {variant === "page" && d.lat !== null && d.lon !== null && (
            <div className="px-6 pb-2">
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
            <p className="mt-3 text-[11.5px] text-faint">
              Primo avvistamento {date(d.first_seen)}
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
        className="space-y-2"
      >
        <Textarea rows={2} placeholder="Aggiungi una nota per lo studio…" value={text} onChange={(e) => setText(e.target.value)} />
        <AnimatePresence>
          {text.trim() && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <Button type="submit" size="sm" variant="primary" loading={add.isPending}>
                Salva nota
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
      <ul className="mt-3 space-y-2">
        {lot.note.map((n) => (
          <li key={n.id} className="group rounded-xl bg-surface-2/70 px-3 py-2.5">
            <p className="whitespace-pre-line text-[13.5px] text-ink">{n.text}</p>
            <div className="mt-1 flex items-center justify-between text-[11.5px] text-faint">
              <span>
                {n.user_name ?? "—"} · {dateTime(n.created_at)}
              </span>
              {(me?.is_admin || me?.id === n.user_id) && (
                <button
                  onClick={() => confirm("Eliminare la nota?") && remove.mutate(n.id)}
                  className="cursor-pointer opacity-0 transition group-hover:opacity-100 hover:text-bad"
                  aria-label="Elimina nota"
                >
                  <Trash2 className="size-3.5" />
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
  const unlink = useMutation({ mutationFn: (lid: number) => del(`/lotti/${lot.id}/clienti/${lid}`), onSuccess: inv });

  return (
    <div className="space-y-2">
      {lot.clienti.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-xl bg-surface-2/70 py-1.5 pr-1.5 pl-3">
          <Link to={`/clienti?id=${c.cliente_id}`} className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink hover:text-gold">
            {c.cliente_name}
          </Link>
          <Select
            value={c.status}
            onChange={(e) => setStatus.mutate({ lid: c.id, status: e.target.value })}
            className="!h-8 !w-auto !rounded-full !bg-surface !text-[12px]"
          >
            {Object.entries(meta?.cliente_status ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <IconButton label="Scollega" className="!size-8" icon={<X className="size-3.5" />} onClick={() => unlink.mutate(c.id)} />
        </div>
      ))}
      {adding ? (
        <div className="space-y-2 rounded-xl hairline p-2.5">
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
            <option value="__new">+ Nuovo cliente…</option>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Annulla
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" icon={<UserPlus className="size-3.5" />} onClick={() => setAdding(true)}>
          Collega cliente
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ events

const EVENT_TONE: Record<string, "ok" | "gold" | "neutral" | "warn" | "bad"> = {
  new_lot: "gold",
  new_round: "gold",
  price_drop: "ok",
  outcome: "neutral",
  postponed: "warn",
  cancelled: "bad",
  deadline_changed: "warn",
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
  if (!events.length) return <p className="text-[13px] text-faint">Nessuna attività registrata.</p>;
  return (
    <ul className="space-y-2">
      {events.slice(0, 12).map((e) => (
        <li key={e.id} className="flex items-start gap-2.5 text-[12.5px]">
          <Bell className="mt-0.5 size-3.5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={EVENT_TONE[e.tipo] ?? "neutral"}>{label(meta?.eventi, e.tipo)}</Badge>
              <span className="num text-muted">{eventDetail(e)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-faint">{dateTime(e.at)}</p>
          </div>
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
      <Button size="sm" variant="gold" icon={<Share2 className="size-3.5" />} onClick={() => setOpen(!open)}>
        Condividi con il cliente
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            className="absolute left-0 z-30 mt-2 w-[340px] max-w-[calc(100vw-48px)]"
          >
            <Card className="p-4 shadow-float">
              <p className="font-serif text-[16px] text-ink">Link di sola lettura</p>
              <p className="mt-1 text-[12.5px] text-muted">
                Il cliente vede la scheda dell'immobile senza note, clienti o contatti. Scade dopo 30 giorni.
              </p>
              <div className="mt-3 space-y-1.5">
                {live.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1.5 pl-3 text-[12px]">
                    <Link2 className="size-3.5 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-muted">scade {date(s.expires_at)}</span>
                    <IconButton
                      label="Copia link"
                      className="!size-7"
                      icon={copied === s.id ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                      onClick={() => copy(s)}
                    />
                    <a href={s.url} target="_blank" rel="noreferrer">
                      <IconButton label="Apri" className="!size-7" icon={<ArrowUpRight className="size-3.5" />} />
                    </a>
                    <IconButton label="Revoca" className="!size-7" icon={<Trash2 className="size-3.5" />} onClick={() => revoke.mutate(s.id)} />
                  </div>
                ))}
              </div>
              <Button className="mt-3 w-full" size="sm" variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                {copied && !live.some((s) => s.id === copied) ? "Copiato" : "Crea e copia un nuovo link"}
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
