const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type FetchOptions = RequestInit & {
  token?: string | null;
};

class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error || response.statusText,
      data
    );
  }

  return data as T;
}

export interface ChallengeResponse {
  challenge: string;
}

export interface VerifyResponse {
  token: string;
}

export interface TradeResponse {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradeListResponse {
  items: TradeResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TradeStatsResponse {
  totalTrades: number;
  totalVolume: number;
  openTrades: number;
}

export interface TradeHistoryEvent {
  eventType: string;
  timestamp: string;
  actor: string;
  metadata: Record<string, unknown>;
}

export interface TradeHistoryResponse {
  events: TradeHistoryEvent[];
}

export interface EvidenceRecord {
  id: string;
  cid: string;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
}

export interface EvidenceResponse {
  evidence: EvidenceRecord[];
}

export interface CreateTradeRequest {
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
}

export interface CreateTradeResponse {
  tradeId: string;
  unsignedXdr: string;
}

export interface DepositResponse {
  unsignedXdr: string;
}

export const api = {
  auth: {
    challenge: (walletAddress: string) =>
      request<ChallengeResponse>("/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ walletAddress }),
      }),

    verify: (walletAddress: string, signedChallenge: string) =>
      request<VerifyResponse>("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ walletAddress, signedChallenge }),
      }),

    logout: (token: string) =>
      request<{ message: string }>("/auth/logout", {
        method: "POST",
        token,
      }),
  },

  trades: {
    list: (token: string, params?: { status?: string; page?: number; limit?: number }) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set("status", params.status);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      const query = searchParams.toString();
      return request<TradeListResponse>(`/trades${query ? `?${query}` : ""}`, { token });
    },

    get: (token: string, id: string) =>
      request<TradeResponse>(`/trades/${id}`, { token }),

    getHistory: (token: string, id: string) =>
      request<TradeHistoryResponse>(`/trades/${id}/history`, { token }),

    getEvidence: (token: string, id: string) =>
      request<EvidenceResponse>(`/trades/${id}/evidence`, { token }),

    getStats: (token: string) =>
      request<TradeStatsResponse>("/trades/stats", { token }),

    create: (token: string, data: CreateTradeRequest) =>
      request<CreateTradeResponse>("/trades", {
        method: "POST",
        token,
        body: JSON.stringify(data),
      }),

    deposit: (token: string, tradeId: string) =>
      request<DepositResponse>(`/trades/${tradeId}/deposit`, {
        method: "POST",
        token,
      }),

    confirmDelivery: (token: string, tradeId: string) =>
      request<{ unsignedXdr: string }>(`/trades/${tradeId}/confirm`, {
        method: "POST",
        token,
      }),

    releaseFunds: (token: string, tradeId: string) =>
      request<{ unsignedXdr: string }>(`/trades/${tradeId}/release`, {
        method: "POST",
        token,
      }),

    initiateDispute: (token: string, tradeId: string, reason: string, category: string) =>
      request<{ unsignedXdr: string }>(`/trades/${tradeId}/dispute`, {
        method: "POST",
        token,
        body: JSON.stringify({ reason, category }),
      }),
  },

  wallet: {
    getBalance: (token: string) =>
      request<{ balance: string; asset: string }>("/wallet/balance", { token }),

    getPathPaymentQuote: (sourceAmount: string, sourceAsset: string, sourceAssetIssuer?: string) => {
      const searchParams = new URLSearchParams({
        sourceAmount,
        sourceAsset,
      });
      if (sourceAssetIssuer) searchParams.set("sourceAssetIssuer", sourceAssetIssuer);
      return request<{ routes: unknown[] }>(`/wallet/path-payment-quote?${searchParams}`);
    },
  },
};

export { ApiError };
