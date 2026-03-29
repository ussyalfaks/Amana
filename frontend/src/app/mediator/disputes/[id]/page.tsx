import MediatorPanelClient from "./MediatorPanelClient";
import Shell from "@/components/Shell";

export default function Page({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { cid?: string };
}) {
  const { id } = params;
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          Mediator Resolution
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Review submitted evidence and resolve dispute #{id}.
        </p>
      </div>
      <MediatorPanelClient disputeId={id} initialCid={searchParams?.cid} />
    </Shell>
  );
}
