-- CreateTable
CREATE TABLE "TicketNumberSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketNumberSequence_pkey" PRIMARY KEY ("year")
);
