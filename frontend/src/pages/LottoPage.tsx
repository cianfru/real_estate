import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { TopBar } from "@/components/AppShell";
import { LottoCard } from "@/components/LottoCard";
import { Button } from "@/components/ui";

export default function LottoPage() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-6xl px-2 py-8 sm:px-6 sm:py-12">
        <div className="no-print mb-2 flex items-center justify-between px-6">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={() => (history.length > 1 ? nav(-1) : nav("/"))}>
            Indietro
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            Stampa la scheda
          </Button>
        </div>
        <LottoCard id={Number(id)} variant="page" />
      </main>
    </div>
  );
}
