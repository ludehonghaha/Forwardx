import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getUserTrafficDailyHistory } from "../userTrafficHistory";

export const userTrafficHistoryRouter = router({
  daily: adminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(31).default(7),
    }).default({ days: 7 }))
    .query(async ({ input }) => getUserTrafficDailyHistory(input.days)),
});
