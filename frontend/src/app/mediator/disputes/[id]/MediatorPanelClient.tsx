"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { Badge } from "@/components/ui/Badge";
import { WalletAddressBadge } from "@/components/ui/WalletAddressBadge";
import { Spinner } from "@/components/ui/Spinner";

type Props = {
  disputeId: string;
  initialCid?: string;
};

const DEFAULT_MEDIATOR_ADDRESSES = ["GEXAMPLEMEDIATORPUBLICKEY1"];

const PINATA_GATEWAYS = [
  process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL?.trim(),
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.io/ipfs",
].filter((value): value is string => Boolean(value));

const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;

function isLikelyIpfsCid(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("Qm") || normalized.startsWith("bafy");
}

function firstValidCidFromUnknown(input: unknown): string | null {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    return isLikelyIpfsCid(input) ? input : null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const cid = firstValidCidFromUnknown(item);
      if (cid) {
        return cid;
      }
    }
    return null;
  }

  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const candidateKeys = [
      "cid",
      "ipfsCid",
      "ipfs_cid",
      "evidenceCid",
      "evidence_cid",
      "videoCid",
      "video_cid",
      "hash",
      "IpfsHash",
    ];

    for (const key of candidateKeys) {
      const value = record[key];
      const cid = firstValidCidFromUnknown(value);
      if (cid) {
        return cid;
      }
    }

    for (const value of Object.values(record)) {
      const cid = firstValidCidFromUnknown(value);
      if (cid) {
        return cid;
      }
    }
  }

  return null;
}

export default function MediatorPanelClient({ disputeId, initialCid }: Props) {
  const { address, isAuthorized, isLoading, connectWallet } =
    useFreighterIdentity();
  const [txStatus, setTxStatus] = useState<string>("");
  const [isSubmittingTx, setIsSubmittingTx] = useState(false);
  const [activeGatewayIndex, setActiveGatewayIndex] = useState(0);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [selectedSellerGetsBps, setSelectedSellerGetsBps] = useState<
    5000 | 7000 | null
  >(null);
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [fetchedCid, setFetchedCid] = useState("");
  const [isFetchingCid, setIsFetchingCid] = useState(false);

  const mediatorAddresses = useMemo(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_MEDIATOR_WALLETS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    return fromEnv.length > 0 ? fromEnv : DEFAULT_MEDIATOR_ADDRESSES;
  }, []);

  const isMediator = Boolean(address && mediatorAddresses.includes(address));

  const cid = useMemo(() => {
    if (fetchedCid && isLikelyIpfsCid(fetchedCid)) {
      return fetchedCid;
    }
    if (initialCid && isLikelyIpfsCid(initialCid)) {
      return initialCid;
    }
    if (isLikelyIpfsCid(disputeId)) {
      return disputeId;
    }
    return "";
  }, [fetchedCid, initialCid, disputeId]);

  useEffect(() => {
    let isActive = true;

    async function fetchEvidenceCid() {
      const numericTradeId = Number(disputeId);
      if (!Number.isInteger(numericTradeId) || numericTradeId < 0) {
        return;
      }

      if (initialCid && isLikelyIpfsCid(initialCid)) {
        return;
      }

      const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ?? "";
      const endpoint = `${baseUrl}/trades/${numericTradeId}/evidence`;

      setIsFetchingCid(true);
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as unknown;
        const discoveredCid = firstValidCidFromUnknown(payload);
        if (discoveredCid && isActive) {
          setFetchedCid(discoveredCid);
          setIsVideoLoading(true);
        }
      } catch {
        // Gracefully continue without CID when evidence endpoint is unavailable.
      } finally {
        if (isActive) {
          setIsFetchingCid(false);
        }
      }
    }

    void fetchEvidenceCid();

    return () => {
      isActive = false;
    };
  }, [disputeId, initialCid]);

  const pinataUrl = cid
    ? `${PINATA_GATEWAYS[activeGatewayIndex]}/${cid}`
    : "";

  function openResolutionConfirmation(sellerGetsBps: 5000 | 7000) {
    setSelectedSellerGetsBps(sellerGetsBps);
    setIsConfirmOpen(true);
    setTxStatus("");
  }

  async function executeResolution(sellerGetsBps: number) {
    if (!address) {
      setTxStatus("Connect Freighter first.");
      return;
    }

    const parsedTradeId = Number(disputeId);
    if (!Number.isInteger(parsedTradeId) || parsedTradeId < 0) {
      setTxStatus("Dispute ID must be a numeric on-chain trade_id.");
      return;
    }

    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL?.trim();

    if (!contractId || !rpcUrl) {
      setTxStatus("Missing NEXT_PUBLIC_CONTRACT_ID or NEXT_PUBLIC_RPC_URL.");
      return;
    }

    setIsSubmittingTx(true);
    setTxStatus("Preparing transaction...");

    try {
      const networkPassphrase =
        process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public"
          ? Networks.PUBLIC
          : DEFAULT_NETWORK_PASSPHRASE;

      const rpcServer = new rpc.Server(rpcUrl);
      const source = await rpcServer.getAccount(address);
      const contract = new Contract(contractId);

      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          contract.call(
            "resolve_dispute",
            nativeToScVal(BigInt(parsedTradeId), { type: "u64" }),
            Address.fromString(address).toScVal(),
            nativeToScVal(sellerGetsBps, { type: "u32" }),
          ),
        )
        .setTimeout(180)
        .build();

      const prepared = await rpcServer.prepareTransaction(tx);
      const signResult = await signTransaction(prepared.toXDR(), {
        networkPassphrase,
        address,
      });

      if (signResult.error) {
        throw new Error(signResult.error.message ?? "Freighter signing failed");
      }

      const signedTx = TransactionBuilder.fromXDR(
        signResult.signedTxXdr,
        networkPassphrase,
      );

      const sendResponse = await rpcServer.sendTransaction(signedTx);
      if (sendResponse.status === "ERROR") {
        throw new Error(
          typeof sendResponse.errorResult === "string"
            ? sendResponse.errorResult
            : JSON.stringify(
                sendResponse.errorResult ?? "Transaction rejected by RPC",
              ),
        );
      }

      setTxStatus(`Submitted. Hash: ${sendResponse.hash}`);
    } catch (error) {
      setTxStatus(
        error instanceof Error ? error.message : "Transaction execution failed",
      );
    } finally {
      setIsSubmittingTx(false);
      setSelectedSellerGetsBps(null);
      setIsConfirmOpen(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-modal relative border border-border-default">
            {pinataUrl ? (
              <>
                {isVideoLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Spinner size="lg" aria-label="Loading evidence video" />
                  </div>
                )}
                <video
                  controls
                  className="w-full h-full object-contain bg-black"
                  src={pinataUrl}
                  onLoadedData={() => setIsVideoLoading(false)}
                  onError={() => {
                    setIsVideoLoading(false);
                    if (activeGatewayIndex < PINATA_GATEWAYS.length - 1) {
                      setActiveGatewayIndex((prev) => prev + 1);
                      setIsVideoLoading(true);
                    } else {
                      setTxStatus("Unable to load evidence video from configured gateways.");
                    }
                  }}
                />
              </>
            ) : (
              <div className="h-full w-full flex items-center justify-center text-center p-6 text-text-secondary text-sm">
                {isFetchingCid
                  ? "Looking up evidence record..."
                  : "Evidence CID is not available for this dispute yet."}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={isMediator ? "success" : "danger"} size="sm" dot>
              {isMediator ? "Mediator access" : "Not a mediator"}
            </Badge>
            <Badge variant="info" size="sm">
              Gateway {activeGatewayIndex + 1}
            </Badge>
            {address ? (
              <WalletAddressBadge
                address={address}
                truncate="middle"
                showCopy
                showExplorer
              />
            ) : (
              <span className="text-text-secondary">Wallet not connected</span>
            )}
            <button
              onClick={() =>
                setActiveGatewayIndex(
                  (prev) => (prev + 1) % PINATA_GATEWAYS.length,
                )
              }
              className="px-3 py-1 rounded-md bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              Switch Gateway
            </button>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="bg-card border border-border-default rounded-2xl shadow-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-text-primary">
              Dispute Resolution
            </h3>
            <p className="text-sm text-text-secondary">
              Select payout ratio for seller and confirm before on-chain signing.
            </p>

            {!isAuthorized && (
              <button
                onClick={() => void connectWallet()}
                disabled={isLoading}
                className="w-full rounded-lg bg-gold text-text-inverse py-2.5 font-medium hover:bg-gold-hover transition-colors disabled:opacity-60"
              >
                {isLoading ? "Connecting..." : "Connect Freighter"}
              </button>
            )}

            {!isMediator && (
              <div className="rounded-md border border-status-danger/40 bg-status-danger/10 text-status-danger text-sm p-3">
                Unauthorized wallet. Access is restricted to mediator addresses.
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => openResolutionConfirmation(5000)}
                className="w-full rounded-lg bg-gold text-text-inverse px-3 py-2.5 font-medium hover:bg-gold-hover transition-colors disabled:opacity-50"
              >
                Resolve 50/50 On-Chain
              </button>

              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => openResolutionConfirmation(7000)}
                className="w-full rounded-lg bg-gold text-text-inverse px-3 py-2.5 font-medium hover:bg-gold-hover transition-colors disabled:opacity-50"
              >
                Resolve 70/30 On-Chain
              </button>
            </div>

            <div className="rounded-md bg-elevated border border-border-default p-3 text-xs text-text-secondary space-y-1">
              <div>Trade ID: {disputeId}</div>
              <div>
                Active gateway: {PINATA_GATEWAYS[activeGatewayIndex]}
              </div>
            </div>

            {txStatus && <p className="text-xs text-text-secondary">{txStatus}</p>}
          </div>
        </div>
      </div>

      <Dialog.Root open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-overlay backdrop-blur-lg z-50 flex items-center justify-center p-4">
            <Dialog.Content className="bg-card border border-border-default shadow-modal max-w-md w-full rounded-2xl flex flex-col">
              <div className="p-5 border-b border-border-default">
                <Dialog.Title className="text-lg font-semibold text-text-primary">
                  Confirm Resolution
                </Dialog.Title>
                <Dialog.Description className="text-sm text-text-secondary mt-1">
                  Review payout split before opening Freighter to sign.
                </Dialog.Description>
              </div>

              <div className="p-5 space-y-3 text-sm">
                <div className="rounded-md border border-border-default bg-elevated p-3">
                  <p className="text-text-secondary">Trade ID</p>
                  <p className="font-medium text-text-primary">{disputeId}</p>
                </div>
                <div className="rounded-md border border-border-default bg-elevated p-3">
                  <p className="text-text-secondary">Seller receives</p>
                  <p className="font-medium text-text-primary">
                    {selectedSellerGetsBps === 7000 ? "70%" : "50%"} ({selectedSellerGetsBps ?? 0} bps)
                  </p>
                </div>
                <div className="rounded-md border border-border-default bg-elevated p-3">
                  <p className="text-text-secondary">Buyer receives</p>
                  <p className="font-medium text-text-primary">
                    {selectedSellerGetsBps === 7000 ? "30%" : "50%"}
                  </p>
                </div>
              </div>

              <div className="p-5 border-t border-border-default flex gap-3">
                <button
                  onClick={() => setIsConfirmOpen(false)}
                  disabled={isSubmittingTx}
                  className="flex-1 px-4 py-2 rounded-lg border border-border-default text-text-secondary hover:bg-elevated transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  disabled={isSubmittingTx || selectedSellerGetsBps === null}
                  onClick={() =>
                    selectedSellerGetsBps !== null &&
                    void executeResolution(selectedSellerGetsBps)
                  }
                  className="flex-1 px-4 py-2 rounded-lg bg-gold text-text-inverse font-medium hover:bg-gold-hover transition-colors disabled:opacity-50"
                >
                  {isSubmittingTx ? "Submitting..." : "Confirm & Sign"}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
