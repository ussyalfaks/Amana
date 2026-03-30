import { PrismaClient } from "@prisma/client";

// Mock minimal Stellar SDK pieces used by the listener
jest.mock("@stellar/stellar-sdk", () => ({
  rpc: { Server: jest.fn() },
  scValToNative: jest.fn(),
}));
import * as StellarSdk from "@stellar/stellar-sdk";
import { EventListenerService } from "../services/eventListener.service";

function createMockPrisma() {
  return {
    trade: { upsert: jest.fn().mockResolvedValue({}) },
    processedLedger: { upsert: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
}

function makeRawEvent(ledger: number) {
  return {
    ledger,
    topic: [{ _scval: "symbol" }, { _scval: "tradeId" }],
    value: null,
  } as any;
}

describe("EventListener idempotency and atomicity (minimal)", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: EventListenerService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new EventListenerService(mockPrisma);
    (service as any).running = true;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not process the same event twice (idempotency)", async () => {
    const raw = makeRawEvent(111);

    // scValToNative returns event symbol then tradeId
    (StellarSdk.scValToNative as jest.Mock)
      .mockReset()
      .mockReturnValueOnce("TradeCreated")
      .mockReturnValueOnce("t1");

    await service.processEvent(raw as any);
    await service.processEvent(raw as any);

    expect(mockPrisma.trade.upsert).toHaveBeenCalledTimes(1);
  });

  it("rolls back / does not record processed ledger when handler fails (atomicity)", async () => {
    const raw = makeRawEvent(222);

    (StellarSdk.scValToNative as jest.Mock)
      .mockReset()
      .mockReturnValueOnce("TradeCreated")
      .mockReturnValueOnce("t2");

    // Make handler fail by causing upsert to throw
    (mockPrisma.trade.upsert as jest.Mock).mockImplementationOnce(() => {
      throw new Error("handler fail");
    });

    await expect(service.processEvent(raw as any)).rejects.toThrow(
      "handler fail",
    );

    // Ensure processed ledger was not upserted after failure
    expect(mockPrisma.processedLedger.upsert).not.toHaveBeenCalled();
  });
});
