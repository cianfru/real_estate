import { ArrowLeft, Printer } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { TopBar } from "@/components/AppShell";
import { LottoCard } from "@/components/LottoCard";
import { Button, Card } from "@/components/ui";

export default function LottoPage() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-10">
        <div className="no-print mb-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => (history.length > 1 ? nav(-1) : nav("/"))}>
            Indietro
          </Button>
          <Button variant="ghost" size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Stampa
          </Button>
        </div>
        <Card className="overflow-visible">
          <LottoCard id={Number(id)} variant="page" />
        </Card>
      </main>
    </div>
  );
}
